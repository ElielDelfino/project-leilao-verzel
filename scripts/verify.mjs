#!/usr/bin/env node
// Verificação em dois níveis (tarefa 011, specs/013 §"Dois níveis de verificação", ADR 0016).
//
//   pnpm verify:quick [-- <arquivos de teste> [-t "<nome>"]] [--base <ref>]
//   pnpm verify:full [--e2e]
//
// quick: só o que mudou desde `git merge-base HEAD main` (commits, alterações e arquivos novos):
//   formato e lint só nesses arquivos; typecheck dos pacotes afetados e dos que dependem deles;
//   testes ligados ao que mudou (src/x.ts → test/x.test.ts, o próprio teste alterado, e os
//   testes de banco quando as migrations, o setup ou os helpers de test/db mudam); banco local via
//   TEMPLATE (LEILAO_TEST_DB=local, apps/api/test/setup/). Roda todos os passos; sai ≠ 0 se algum
//   falhar. contracts:lint e contracts:check rodam quando um contrato (openapi, eventbus, contracts,
//   redocly, scripts/contracts-*) muda.
// full: formato, lint, typecheck, todos os testes, contrato e build (--e2e: Playwright). Para na
//   primeira falha.
// Saída: resumo com ✓/✗/pulado e o tempo de cada passo.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const OK = '✓';
const FALHOU = '✗';
const PULADO = 'pulado';

const EXTENSOES_DE_LINT = /\.(js|mjs|cjs|ts|mts|cts|tsx)$/;
const EXTENSOES_TS = /\.(ts|mts|cts|tsx)$/;
const ARQUIVO_DE_TESTE = /\.test\.(ts|mts|tsx)$/;
const DIRETORIOS_IGNORADOS = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite']);

/** Mudou um destes: todos os pacotes são afetados (configuração compartilhada do TypeScript). */
const ARQUIVOS_GLOBAIS = new Set(['tsconfig.base.json', 'package.json', 'pnpm-lock.yaml']);

/** Config do Vitest por pacote quando não é a padrão (a da API liga o setup do banco de teste). */
const CONFIG_DE_TESTE = { 'apps/api': 'test/setup/vitest.config.ts' };

/** Pacote dono dos testes de banco e o que, ao mudar, faz rodá-los no quick. */
const PACOTE_DO_BANCO = 'apps/api';
// Desde a tarefa 025 os testes de banco ficam em test/db/ (com o helper ambiente-de-teste.ts).
const GATILHOS_DO_BANCO = [
  'database/postgres/migrations/',
  'apps/api/test/setup/',
  'apps/api/test/db/',
];
const TESTES_DO_BANCO = ['test/db/', 'test/setup/'];

/** Mudou a config do ESLint ou do TS: o teste de fronteiras (tarefa 013) usa o eslint real. */
const GATILHOS_DE_FRONTEIRAS = new Set(['eslint.config.mjs', 'tsconfig.base.json']);
const TESTE_DE_FRONTEIRAS = 'test/boundaries/fronteiras.test.ts';

/**
 * Mudou o openapi.yaml: todos os testes da API rodam (tarefa 066). criarAppDeTeste valida cada
 * resposta contra o yaml, então qualquer teste de integração pode quebrar. O asyncapi.yaml fica
 * de fora: nenhum teste da API o lê; quem o cobre é contracts:check/lint (ver mudouContrato).
 */
const GATILHO_DE_RIGOR_DO_CONTRATO = 'apps/api/openapi.yaml';
const TESTES_DA_API = ['test/'];

const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1']);
const ESPERA_DO_POSTGRES_MS = 1000;

// ---------------------------------------------------------------- argumentos

const USO = `uso:
  pnpm verify:quick [-- <arquivos de teste...>] [-t "<nome>"] [--base <ref>]
  pnpm verify:full [--e2e]`;

/** Lê o argv (sem node e o script). Lança com a mensagem de uso se algo não for reconhecido. */
export function lerArgumentos(argv) {
  const [modo, ...resto] = argv;
  if (modo !== 'quick' && modo !== 'full') {
    throw new Error(`modo inválido: ${JSON.stringify(modo ?? '')}\n${USO}`);
  }
  const opcoes = { modo, arquivos: [], nome: undefined, base: undefined, e2e: false };
  for (let i = 0; i < resto.length; i++) {
    const arg = resto[i];
    const valor = () => {
      const proximo = resto[++i];
      if (proximo === undefined) throw new Error(`${arg} precisa de um valor\n${USO}`);
      return proximo;
    };
    if (arg === '--') continue;
    if (arg === '-t' || arg === '--testNamePattern') opcoes.nome = valor();
    else if (arg.startsWith('--testNamePattern=')) opcoes.nome = arg.slice(arg.indexOf('=') + 1);
    else if (arg === '--base') opcoes.base = valor();
    else if (arg === '--e2e') opcoes.e2e = true;
    else if (arg.startsWith('-')) throw new Error(`opção desconhecida: ${arg}\n${USO}`);
    else opcoes.arquivos.push(arg);
  }
  if (modo === 'full' && (opcoes.arquivos.length > 0 || opcoes.nome || opcoes.base)) {
    throw new Error(`verify:full roda tudo: arquivos, -t e --base são só do quick\n${USO}`);
  }
  if (modo === 'quick' && opcoes.e2e) {
    throw new Error(`--e2e é só do verify:full\n${USO}`);
  }
  return opcoes;
}

// ---------------------------------------------------------------- ambiente

/** .env e .env.local da raiz (como os scripts db:*); o que já está no ambiente tem precedência. */
export function ambienteDoRepositorio(raiz, envAtual) {
  const lerArquivo = (nome) => {
    const caminho = join(raiz, nome);
    return existsSync(caminho) ? parseEnv(readFileSync(caminho, 'utf8')) : {};
  };
  return { ...lerArquivo('.env'), ...lerArquivo('.env.local'), ...envAtual };
}

// ---------------------------------------------------------------- pacotes do workspace

/** Pastas de pacote do pnpm-workspace.yaml (só padrões "dir/*" e "dir", os usados aqui). */
function pastasDoWorkspace(raiz) {
  const linhas = readFileSync(join(raiz, 'pnpm-workspace.yaml'), 'utf8').split('\n');
  const inicio = linhas.findIndex((linha) => /^packages:\s*$/.test(linha));
  const padroes = [];
  for (const linha of linhas.slice(inicio + 1)) {
    const item = /^\s+-\s+['"]?([^'"#\s]+)['"]?/.exec(linha);
    if (!item) break;
    padroes.push(item[1]);
  }
  return padroes.flatMap((padrao) => {
    if (padrao.endsWith('/*')) {
      const base = padrao.slice(0, -2);
      if (!existsSync(join(raiz, base))) return [];
      return readdirSync(join(raiz, base), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(raiz, base, d.name, 'package.json')))
        .map((d) => `${base}/${d.name}`);
    }
    if (padrao.includes('*'))
      throw new Error(`pnpm-workspace.yaml: padrão não suportado: ${padrao}`);
    return [padrao];
  });
}

function temArquivoTs(pasta) {
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (!DIRETORIOS_IGNORADOS.has(entrada.name) && temArquivoTs(join(pasta, entrada.name))) {
        return true;
      }
    } else if (EXTENSOES_TS.test(entrada.name) && !entrada.name.endsWith('.d.ts')) {
      return true;
    }
  }
  return false;
}

/** Pacotes do workspace com o que o verify precisa saber de cada um. */
export function lerPacotes(raiz) {
  return pastasDoWorkspace(raiz).map((pasta) => {
    const manifesto = JSON.parse(readFileSync(join(raiz, pasta, 'package.json'), 'utf8'));
    const dependencias = { ...manifesto.dependencies, ...manifesto.devDependencies };
    return {
      pasta,
      nome: manifesto.name,
      scripts: manifesto.scripts ?? {},
      dependencias: Object.keys(dependencias),
      temTs: temArquivoTs(join(raiz, pasta)),
      temVitest: 'vitest' in dependencias,
    };
  });
}

/** Pacotes com código TS sem script typecheck: o typecheck ficaria verde sem checar nada. */
export function pacotesSemTypecheck(pacotes) {
  return pacotes.filter((p) => p.temTs && !p.scripts.typecheck).map((p) => p.nome);
}

const dentroDe = (pasta, arquivo) => arquivo.startsWith(`${pasta}/`);

/** Pacotes afetados pelos arquivos alterados, mais os que dependem deles (transitivamente). */
export function pacotesAfetados(pacotes, alterados) {
  const afetados = new Set(
    alterados.some((a) => ARQUIVOS_GLOBAIS.has(a))
      ? pacotes.map((p) => p.nome)
      : pacotes.filter((p) => alterados.some((a) => dentroDe(p.pasta, a))).map((p) => p.nome),
  );
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const p of pacotes) {
      if (!afetados.has(p.nome) && p.dependencias.some((d) => afetados.has(d))) {
        afetados.add(p.nome);
        cresceu = true;
      }
    }
  }
  return pacotes.filter((p) => afetados.has(p.nome));
}

// ---------------------------------------------------------------- contratos

/** Arquivos cuja mudança liga contracts:lint e contracts:check no quick (tarefa 046). */
const ARQUIVOS_DE_CONTRATO =
  /^(apps\/api\/openapi\.yaml|eventbus\/.+|packages\/contracts\/.+|redocly\.yaml|\.redocly\.lint-ignore\.yaml|scripts\/contracts-[^/]+\.mjs)$/;

/** Algum contrato, gerado ou ferramenta de contratos mudou (caminhos relativos à raiz, com "/"). */
export function mudouContrato(alterados) {
  return alterados.some((a) => ARQUIVOS_DE_CONTRATO.test(a));
}

// ---------------------------------------------------------------- testes ligados ao que mudou

/**
 * Testes (relativos ao pacote) ligados a um arquivo alterado do pacote (specs/013):
 * o próprio teste, ou src/x.ts(x) → test/x.test.ts(x). Os configs do Vitest coletam só test/.
 */
function testesDoArquivo(relativoAoPacote) {
  if (ARQUIVO_DE_TESTE.test(relativoAoPacote)) return [relativoAoPacote];
  if (!relativoAoPacote.startsWith('src/') || !EXTENSOES_TS.test(relativoAoPacote)) return [];
  const base = relativoAoPacote.slice('src/'.length).replace(EXTENSOES_TS, '');
  return ['ts', 'tsx'].map((ext) => `test/${base}.test.${ext}`);
}

function listarTestes(raiz, pasta, prefixos) {
  const encontrados = [];
  const visitar = (relativo) => {
    const absoluto = join(raiz, pasta, relativo);
    if (!existsSync(absoluto)) return;
    for (const entrada of readdirSync(absoluto, { withFileTypes: true })) {
      const filho = relativo ? `${relativo}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory() && !DIRETORIOS_IGNORADOS.has(entrada.name)) visitar(filho);
      else if (ARQUIVO_DE_TESTE.test(entrada.name)) encontrados.push(filho);
    }
  };
  for (const prefixo of prefixos) visitar(prefixo.replace(/\/$/, ''));
  return encontrados;
}

/**
 * Testes a rodar por pacote (Map pasta → arquivos relativos ao pacote), a partir dos alterados.
 * `existe` recebe o caminho relativo à raiz (injetável nos testes).
 */
export function testesRelacionados(raiz, pacotes, alterados, existe) {
  const porPacote = new Map();
  const adicionar = (pasta, arquivo) => {
    if (!existe(`${pasta}/${arquivo}`)) return;
    porPacote.set(pasta, [...new Set([...(porPacote.get(pasta) ?? []), arquivo])].sort());
  };
  for (const pacote of pacotes.filter((p) => p.temVitest)) {
    for (const alterado of alterados.filter((a) => dentroDe(pacote.pasta, a))) {
      for (const teste of testesDoArquivo(alterado.slice(pacote.pasta.length + 1))) {
        adicionar(pacote.pasta, teste);
      }
    }
  }
  if (alterados.some((a) => GATILHOS_DO_BANCO.some((g) => a.startsWith(g)))) {
    for (const teste of listarTestes(raiz, PACOTE_DO_BANCO, TESTES_DO_BANCO)) {
      adicionar(PACOTE_DO_BANCO, teste);
    }
  }
  if (alterados.some((a) => GATILHOS_DE_FRONTEIRAS.has(a))) {
    adicionar(PACOTE_DO_BANCO, TESTE_DE_FRONTEIRAS);
  }
  if (alterados.includes(GATILHO_DE_RIGOR_DO_CONTRATO)) {
    for (const teste of listarTestes(raiz, PACOTE_DO_BANCO, TESTES_DA_API)) {
      adicionar(PACOTE_DO_BANCO, teste);
    }
  }
  return porPacote;
}

/** Arquivos de teste explícitos (pnpm verify:quick -- <arquivos>) agrupados por pacote. */
export function testesExplicitos(raiz, pacotes, arquivos, diretorioAtual) {
  const porPacote = new Map();
  const scripts = [];
  for (const arquivo of arquivos) {
    const candidatos = [
      resolve(diretorioAtual, arquivo),
      resolve(raiz, arquivo),
      ...pacotes.filter((p) => p.temVitest).map((p) => resolve(raiz, p.pasta, arquivo)),
    ].filter((c, i, todos) => todos.indexOf(c) === i && existsSync(c) && statSync(c).isFile());
    const relativos = [...new Set(candidatos.map((c) => relative(raiz, c).split(sep).join('/')))];
    if (relativos.length === 0) throw new Error(`arquivo de teste não encontrado: ${arquivo}`);
    if (relativos.length > 1) {
      throw new Error(
        `arquivo ambíguo: ${arquivo} (${relativos.join(', ')}); use o caminho da raiz`,
      );
    }
    const [relativo] = relativos;
    if (/^scripts\/[^/]+\.test\.mjs$/.test(relativo)) {
      scripts.push(relativo);
      continue;
    }
    const pacote = pacotes.find((p) => p.temVitest && dentroDe(p.pasta, relativo));
    if (!pacote) throw new Error(`${relativo} não está num pacote com Vitest nem em scripts/`);
    const noPacote = relativo.slice(pacote.pasta.length + 1);
    porPacote.set(pacote.pasta, [...(porPacote.get(pacote.pasta) ?? []), noPacote]);
  }
  return { porPacote, scripts };
}

// ---------------------------------------------------------------- git

function git(args, cwd = RAIZ) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} falhou: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return r.stdout;
}

/** Merge-base de HEAD com `ref`, ou undefined se a ref não existe (ou não há histórico comum). */
function mergeBase(ref, cwd) {
  const r = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function ehAncestral(antigo, recente, cwd) {
  return spawnSync('git', ['merge-base', '--is-ancestor', antigo, recente], { cwd }).status === 0;
}

/**
 * Base da comparação do quick: `--base <ref>`, ou o merge-base de HEAD com `main` e `origin/main`.
 * Quando os dois existem e divergem, vale o mais antigo (compara com mais arquivos, nunca com
 * menos) e devolve um `aviso`.
 */
export function baseDaComparacao(base, cwd = RAIZ) {
  const candidatos = base ? [base] : ['main', 'origin/main'];
  const achados = candidatos
    .map((ref) => ({ ref, sha: mergeBase(ref, cwd) }))
    .filter((c) => c.sha !== undefined);
  if (achados.length === 0) {
    throw new Error(
      `não achei o merge-base de HEAD com ${candidatos.join(' nem ')}; use --base <ref>`,
    );
  }
  const [primeiro, segundo] = achados;
  if (segundo === undefined || primeiro.sha === segundo.sha) return primeiro;
  const maisAntigo = ehAncestral(primeiro.sha, segundo.sha, cwd) ? primeiro : segundo;
  return {
    ...maisAntigo,
    aviso:
      `${primeiro.ref} (${primeiro.sha.slice(0, 7)}) e ${segundo.ref} (${segundo.sha.slice(0, 7)}) ` +
      `divergem; usando o mais antigo (${maisAntigo.ref})`,
  };
}

/** Alterados desde a base: commits, staged, não staged, novos não ignorados e apagados. */
export function arquivosAlterados(sha, cwd = RAIZ) {
  // -z: caminhos crus separados por NUL. Sem ele, nomes com acento ou espaço saem entre aspas e
  // com escapes em octal ("a\303\247\303\243o x.ts") e não casam com nenhum arquivo.
  const caminhos = (saida) => saida.split('\0').filter(Boolean);
  const diff = caminhos(git(['diff', '--name-only', '--no-renames', '-z', sha], cwd));
  const novos = caminhos(git(['ls-files', '--others', '--exclude-standard', '-z'], cwd));
  return [...new Set([...diff, ...novos])].sort();
}

// ---------------------------------------------------------------- execução dos passos

function executar(comando, args, { cwd = RAIZ, env }) {
  process.stdout.write(
    `\n▶ ${comando} ${args.join(' ')}${cwd === RAIZ ? '' : `  (em ${relative(RAIZ, cwd)})`}\n`,
  );
  const r = spawnSync(comando, args, { cwd, env, stdio: 'inherit' });
  if (r.error) {
    process.stderr.write(`não consegui executar ${comando}: ${r.error.message}\n`);
    return false;
  }
  return r.status === 0;
}

function postgresAceitaConexao(host, porta) {
  return new Promise((aceita) => {
    const socket = connect({ host, port: porta });
    const fim = (ok) => {
      socket.destroy();
      aceita(ok);
    };
    socket.setTimeout(ESPERA_DO_POSTGRES_MS, () => fim(false));
    socket.once('connect', () => fim(true));
    socket.once('error', () => fim(false));
  });
}

const VARIAVEIS_DO_BANCO = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'DB_PASSWORD',
];

/** Postgres local no ar para LEILAO_TEST_DB=local; se estiver fora, tenta `pnpm infra:up`. */
async function garantirPostgresLocal(env) {
  const faltando = VARIAVEIS_DO_BANCO.filter((nome) => !env[nome]);
  if (faltando.length > 0) {
    process.stderr.write(
      `Faltam variáveis do banco: ${faltando.join(', ')}. Rode \`pnpm keys:generate\` (cria o .env.local).\n`,
    );
    return false;
  }
  const host = env.POSTGRES_HOST;
  const porta = Number(env.POSTGRES_PORT);
  if (await postgresAceitaConexao(host, porta)) return true;
  const comando = 'pnpm infra:up --wait';
  if (!HOSTS_LOCAIS.has(host)) {
    process.stderr.write(
      `Postgres fora em ${host}:${porta} (host não local). Suba-o e rode de novo.\n`,
    );
    return false;
  }
  // Sem .env.local o compose não sobe (infra:up passa --env-file .env.local).
  if (!existsSync(join(RAIZ, '.env.local'))) {
    process.stderr.write(
      `Postgres fora em ${host}:${porta}. Suba com: pnpm keys:generate && ${comando}\n`,
    );
    return false;
  }
  process.stdout.write(`Postgres fora em ${host}:${porta}; tentando \`${comando}\`.\n`);
  if (
    !executar('pnpm', ['infra:up', '--wait'], { env }) ||
    !(await postgresAceitaConexao(host, porta))
  ) {
    process.stderr.write(`Não consegui subir o Postgres. Rode \`${comando}\` e veja o erro.\n`);
    return false;
  }
  return true;
}

class Verificacao {
  constructor(modo, pararNaPrimeiraFalha) {
    this.modo = modo;
    this.pararNaPrimeiraFalha = pararNaPrimeiraFalha;
    this.passos = [];
  }

  get falhou() {
    return this.passos.some((p) => p.resultado === FALHOU);
  }

  pular(nome, motivo) {
    this.passos.push({ nome, resultado: PULADO, motivo, ms: 0 });
  }

  /** `acao` devolve true (ok) ou false (falha); exceção também conta como falha. */
  async passo(nome, acao) {
    if (this.pararNaPrimeiraFalha && this.falhou) {
      this.pular(nome, 'falha anterior');
      return false;
    }
    const inicio = performance.now();
    let ok;
    try {
      ok = await acao();
    } catch (erro) {
      process.stderr.write(`${nome}: ${erro instanceof Error ? erro.message : String(erro)}\n`);
      ok = false;
    }
    this.passos.push({ nome, resultado: ok ? OK : FALHOU, ms: performance.now() - inicio });
    return ok;
  }

  resumo(msTotal) {
    const largura = Math.max(...this.passos.map((p) => p.nome.length), 10);
    const linhas = this.passos.map((p) => {
      const tempo = p.resultado === PULADO ? `(${p.motivo})` : formatarTempo(p.ms);
      return `  ${p.resultado.padEnd(6)} ${p.nome.padEnd(largura)}  ${tempo}`;
    });
    const status = this.falhou ? 'FALHOU' : 'ok';
    return `\nResumo do verify:${this.modo}\n${linhas.join('\n')}\n  total ${formatarTempo(msTotal)}: ${status}\n`;
  }
}

export function formatarTempo(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

// ---------------------------------------------------------------- passos comuns

function argsDoVitest(pasta, arquivos, nome) {
  const config = CONFIG_DE_TESTE[pasta];
  return [
    'exec',
    'vitest',
    'run',
    ...(config ? ['--config', config] : []),
    ...arquivos,
    ...(nome ? ['-t', nome] : []),
  ];
}

async function passoTypecheckGuarda(v, pacotes) {
  await v.passo('typecheck: todo pacote TS tem script', () => {
    const sem = pacotesSemTypecheck(pacotes);
    for (const nome of sem) {
      const pasta = pacotes.find((p) => p.nome === nome)?.pasta;
      process.stderr.write(
        `O pacote ${nome} (${pasta}) tem TypeScript mas não tem o script "typecheck" no package.json.\n`,
      );
    }
    return sem.length === 0;
  });
}

/** porPacote: Map pasta → arquivos, ou 'todos' (suíte inteira de cada pacote com Vitest). */
async function passoTestes(v, pacotes, porPacote, { nome, semTestes }, env) {
  for (const pacote of pacotes.filter((p) => p.temVitest)) {
    const arquivos = porPacote === 'todos' ? [] : porPacote.get(pacote.pasta);
    const titulo = `testes ${pacote.nome}`;
    if (arquivos === undefined) {
      v.pular(titulo, semTestes);
      continue;
    }
    const usaBanco = pacote.pasta === PACOTE_DO_BANCO;
    if (usaBanco && !(await v.passo('postgres local', () => garantirPostgresLocal(env)))) {
      v.pular(titulo, 'sem Postgres');
      continue;
    }
    const envDoPacote = usaBanco ? { ...env, LEILAO_TEST_DB: 'local' } : env;
    await v.passo(titulo, () =>
      executar('pnpm', argsDoVitest(pacote.pasta, arquivos, nome), {
        cwd: join(RAIZ, pacote.pasta),
        env: envDoPacote,
      }),
    );
  }
}

// ---------------------------------------------------------------- quick

async function quick(opcoes, env) {
  const v = new Verificacao('quick', false);
  const pacotes = lerPacotes(RAIZ);
  const base = baseDaComparacao(opcoes.base);
  const alterados = arquivosAlterados(base.sha);
  const existe = (relativo) => existsSync(join(RAIZ, relativo));
  const presentes = alterados.filter(existe);
  process.stdout.write(
    `verify:quick: ${alterados.length} arquivo(s) alterado(s) desde ${base.ref} (${base.sha.slice(0, 7)})\n`,
  );
  if (base.aviso) process.stdout.write(`aviso: ${base.aviso}\n`);
  // specs/013 §Modo local: o banco de teste é do worktree; dois verify no mesmo worktree se atropelam.
  process.stdout.write(
    'aviso: rode um verify por vez em cada worktree (o banco de teste é um só).\n',
  );
  // Testes explícitos substituem os ligados ao que mudou; arquivo inexistente falha já aqui.
  const explicitos =
    opcoes.arquivos.length > 0
      ? testesExplicitos(RAIZ, pacotes, opcoes.arquivos, env.INIT_CWD ?? process.cwd())
      : undefined;
  const porPacote = explicitos?.porPacote ?? testesRelacionados(RAIZ, pacotes, alterados, existe);
  const semTestes = explicitos ? 'nenhum teste pedido' : 'nenhum teste ligado ao que mudou';

  if (presentes.length === 0) v.pular('formato', 'nada alterado');
  else {
    await v.passo('formato', () =>
      // `--`: um arquivo começando com "-" não vira opção.
      executar('pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', '--', ...presentes], {
        env,
      }),
    );
  }

  const lintaveis = presentes.filter((a) => EXTENSOES_DE_LINT.test(a));
  if (lintaveis.length === 0) v.pular('lint', 'nenhum JS/TS alterado');
  else {
    await v.passo('lint', () =>
      executar('pnpm', ['exec', 'eslint', '--no-warn-ignored', '--', ...lintaveis], { env }),
    );
  }

  await passoTypecheckGuarda(v, pacotes);
  const afetados = pacotesAfetados(pacotes, alterados).filter((p) => p.scripts.typecheck);
  if (afetados.length === 0) v.pular('typecheck', 'nenhum pacote afetado');
  for (const pacote of afetados) {
    await v.passo(`typecheck ${pacote.nome}`, () =>
      executar('pnpm', ['--filter', pacote.nome, 'run', 'typecheck'], { env }),
    );
  }

  const testesDeScripts = explicitos
    ? explicitos.scripts
    : alterados.some((a) => /^scripts\/[^/]+\.mjs$/.test(a))
      ? ['scripts/*.test.mjs']
      : [];
  if (testesDeScripts.length === 0) {
    v.pular('testes de scripts', explicitos ? semTestes : 'nada em scripts/*.mjs mudou');
  } else {
    const nome = opcoes.nome ? [`--test-name-pattern=${opcoes.nome}`] : [];
    await v.passo('testes de scripts', () =>
      executar('node', ['--test', ...nome, ...testesDeScripts], { env }),
    );
  }

  await passoTestes(v, pacotes, porPacote, { nome: opcoes.nome, semTestes }, env);
  await passosDeContratos(v, mudouContrato(alterados), env);
  return v;
}

/** contracts:lint e contracts:check: no quick só quando um contrato mudou; no full, sempre. */
async function passosDeContratos(v, rodar, env) {
  const scriptsDaRaiz = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).scripts ?? {};
  for (const script of ['contracts:lint', 'contracts:check']) {
    if (!rodar) v.pular(script, 'nenhum contrato mudou');
    else if (!scriptsDaRaiz[script]) v.pular(script, 'script ainda não existe (tarefa 021)');
    else await v.passo(script, () => executar('pnpm', ['run', script], { env }));
  }
}

// ---------------------------------------------------------------- full

/** O e2e conecta a API como leilao_api e sobe o banco, o Redis e o seed: sem elas nada sobe. */
const VARIAVEIS_DO_E2E = [
  'POSTGRES_API_USER',
  'DB_API_PASSWORD',
  'POSTGRES_USER',
  'DB_PASSWORD',
  'POSTGRES_DB',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'SEED_DEMO_PASSWORD',
];

/** Nomes (nunca valores) das variáveis do e2e ausentes ou vazias. */
export function variaveisFaltandoParaOE2e(env) {
  return VARIAVEIS_DO_E2E.filter((nome) => env[nome] === undefined || env[nome] === '');
}

async function full(opcoes, env) {
  const v = new Verificacao('full', true);
  const pacotes = lerPacotes(RAIZ);

  await v.passo('formato', () => executar('pnpm', ['run', 'format:check'], { env }));
  await v.passo('lint', () => executar('pnpm', ['run', 'lint'], { env }));
  await passoTypecheckGuarda(v, pacotes);
  await v.passo('typecheck', () => executar('pnpm', ['run', 'typecheck'], { env }));
  await v.passo('testes de scripts', () => executar('pnpm', ['run', 'test:scripts'], { env }));
  // Banco: o leilao_test_<sufixo> do worktree via TEMPLATE. O Testcontainers (specs/013)
  // depende de um pedido ao infra (allowBuilds no pnpm-workspace.yaml); veja a tarefa 011.
  await passoTestes(v, pacotes, 'todos', { nome: undefined, semTestes: '' }, env);
  await passosDeContratos(v, true, env);
  await v.passo('build', () =>
    executar('pnpm', ['--recursive', '--if-present', 'run', 'build'], { env }),
  );
  if (opcoes.e2e) {
    await v.passo('e2e (Playwright)', () => {
      const config = readdirSync(RAIZ).find((nome) => nome.startsWith('playwright.config.'));
      if (!config) {
        process.stderr.write('--e2e pedido, mas não há playwright.config.* na raiz.\n');
        return false;
      }
      const faltando = variaveisFaltandoParaOE2e(env);
      if (faltando.length > 0) {
        // Só os nomes: o valor de uma variável nunca é impresso.
        process.stderr.write(`e2e: variável(is) ausente(s): ${faltando.join(', ')}\n`);
        return false;
      }
      return executar('pnpm', ['exec', 'playwright', 'test'], { env });
    });
  }
  return v;
}

// ---------------------------------------------------------------- principal

async function principal() {
  const inicio = performance.now();
  let opcoes;
  try {
    opcoes = lerArgumentos(process.argv.slice(2));
  } catch (erro) {
    process.stderr.write(`${erro.message}\n`);
    return 2;
  }
  const env = ambienteDoRepositorio(RAIZ, process.env);
  let v;
  try {
    v = opcoes.modo === 'quick' ? await quick(opcoes, env) : await full(opcoes, env);
  } catch (erro) {
    process.stderr.write(`verify:${opcoes.modo}: ${erro instanceof Error ? erro.message : erro}\n`);
    return 1;
  }
  process.stdout.write(v.resumo(performance.now() - inicio));
  return v.falhou ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await principal();
}
