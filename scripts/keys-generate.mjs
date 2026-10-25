#!/usr/bin/env node
// `pnpm keys:generate`: cria o .env.local com os segredos de desenvolvimento (tasks 010 e 023) e os
// arquivos de senha que o Compose monta como `secrets:` (task 002).
// Fonte: specs/014 §Segredos e ADR 0023 (dev usa .env.local; prod usa o GCP Secret Manager).
// Nunca imprime valores: a saída lista só nomes de variáveis e caminhos de arquivos.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import * as ed from '@noble/ed25519';

const RAIZ = resolve(import.meta.dirname, '..');
const CAMINHO_PADRAO = join(RAIZ, '.env.local');

// Os 6 segredos são 32 bytes em base64url sem padding (ADR 0023 §Decisão, item 4; ADR 0026).
const BYTES_256_BITS = 32;
// Sufixo aleatório do backup: dois --force no mesmo milissegundo não colidem.
const BYTES_SUFIXO_BACKUP = 3;
const PERMISSAO_SO_DONO = 0o600;
const PERMISSAO_DIRETORIO_SO_DONO = 0o700;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const VARIAVEIS = Object.freeze([
  'DB_PASSWORD',
  'DB_API_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_SECRET',
  'PSEUDONYM_HMAC_KEY',
  'ED25519_PRIVATE_KEY',
]);

// Saíram com a ADR 0023: o keyId é derivado da chave pública (item 5) e SEED_DEMO_PASSWORD é pública,
// fixa no .env (item 6). Num .env.local antigo elas sobrescrevem o .env, então o script avisa.
export const VARIAVEIS_OBSOLETAS = Object.freeze(['ED25519_KEY_ID', 'SEED_DEMO_PASSWORD']);

// Usuário `node` da imagem da API (apps/api/Dockerfile). O Compose ignora uid, gid e mode de
// secrets com `file:` (ADR 0023 §Consequências): no compose de produção, a API só lê os arquivos de
// .secrets/ se o dono deles for esse uid.
export const UID_DA_API = 1000;

// Diretório, ao lado do .env.local, com uma senha por arquivo (sem quebra de linha) para o Compose
// `secrets:`: o Postgres lê via POSTGRES_PASSWORD_FILE e o Redis no entrypoint. Assim as senhas não
// aparecem no `Config.Env` do `docker inspect`. O .env.local continua com os valores para a API.
export const DIRETORIO_DE_SEGREDOS = '.secrets';
export const SEGREDOS_EM_ARQUIVO = Object.freeze({
  DB_PASSWORD: 'db_password',
  REDIS_PASSWORD: 'redis_password',
});

const aleatorioBase64url = (bytes) => randomBytes(bytes).toString('base64url');

async function gerarSegredos() {
  const { secretKey } = await ed.keygenAsync();
  return Object.freeze({
    DB_PASSWORD: aleatorioBase64url(BYTES_256_BITS),
    // Senha do papel `leilao_api` (ADR 0026); o `db:migrate` a aplica ao papel.
    DB_API_PASSWORD: aleatorioBase64url(BYTES_256_BITS),
    REDIS_PASSWORD: aleatorioBase64url(BYTES_256_BITS),
    JWT_SECRET: aleatorioBase64url(BYTES_256_BITS),
    PSEUDONYM_HMAC_KEY: aleatorioBase64url(BYTES_256_BITS),
    // Seed de 32 bytes da RFC 8032 §5.1.5; a API deriva dela a chave pública e o keyId.
    ED25519_PRIVATE_KEY: Buffer.from(secretKey).toString('base64url'),
  });
}

function montarConteudo(segredos) {
  const cabecalho = [
    '# Segredos locais gerados por `pnpm keys:generate` (task 010). NÃO versionar e NÃO compartilhar.',
    '# Descrição de cada variável: docs/variaveis-de-ambiente.md. Regerar: pnpm keys:generate --force',
  ];
  const linhas = VARIAVEIS.map((nome) => `${nome}=${segredos[nome]}`);
  return [...cabecalho, ...linhas, ''].join('\n');
}

// Temporário e backup ficam ao lado do alvo, com nomes que casam com `.env.*.local` do .gitignore.
export function nomeTemporario(caminho) {
  return join(dirname(caminho), `.env.tmp-${process.pid}-${basename(caminho)}.local`);
}

const carimbo = (agora) => agora.toISOString().replace(/[:.]/g, '-');
const sufixoAleatorio = () => randomBytes(BYTES_SUFIXO_BACKUP).toString('hex');

export function nomeBackup(caminho, agora = new Date()) {
  return join(dirname(caminho), `.env.bak-${carimbo(agora)}-${sufixoAleatorio()}.local`);
}

// Backup de um arquivo de .secrets/: o nome diz de qual senha é; o diretório inteiro é ignorado.
export function nomeBackupDeSegredo(caminho, agora = new Date()) {
  return `${caminho}.bak-${carimbo(agora)}-${sufixoAleatorio()}`;
}

function falhar(mensagem) {
  throw new Error(mensagem);
}

// Git sem as variáveis GIT_* herdadas (um hook define GIT_DIR) e com mensagens em inglês,
// para reconhecer "not a git repository" em qualquer locale.
function rodarGit(diretorio, args) {
  const ambiente = Object.fromEntries(
    Object.entries(process.env).filter(([nome]) => !nome.startsWith('GIT_')),
  );
  const saida = spawnSync('git', ['-C', diretorio, ...args], {
    encoding: 'utf8',
    env: { ...ambiente, LC_ALL: 'C' },
  });
  if (saida.error)
    falhar(`não foi possível rodar o git para checar o destino: ${saida.error.message}`);
  return saida;
}

// Versionável = dentro de uma working tree git e não ignorado (arquivo já rastreado conta como
// versionável). O git roda a partir de `base` (diretório que existe) com o caminho relativo, então
// funciona antes de .secrets/ existir. Na dúvida, falha fechada.
function versionavel(base, caminho) {
  const relativo = relative(base, caminho);
  const arvore = rodarGit(base, ['rev-parse', '--is-inside-work-tree']);
  if (arvore.status !== 0) {
    if (/not a git repository/.test(arvore.stderr)) return false;
    falhar(`não foi possível checar o git em ${base}: ${arvore.stderr.trim()}`);
  }
  if (arvore.stdout.trim() !== 'true') return false;
  const ignorado = rodarGit(base, ['check-ignore', '-q', '--', relativo]);
  if (ignorado.status === 0) return false;
  if (ignorado.status === 1) return true;
  falhar(`git check-ignore falhou para ${caminho}: ${ignorado.stderr.trim()}`);
}

function garantirNaoVersionaveis(base, caminhos) {
  for (const caminho of caminhos) {
    if (versionavel(base, caminho)) {
      falhar(
        `${caminho} pode ser versionado pelo git (não é ignorado). Use um caminho fora do` +
          ' repositório ou coberto pelo .gitignore; nada foi gravado.',
      );
    }
  }
}

// Normaliza o diretório com realpath (o git devolve caminhos reais) e exige que ele exista.
function resolverDestino(caminho) {
  const absoluto = resolve(caminho);
  try {
    return join(realpathSync(dirname(absoluto)), basename(absoluto));
  } catch {
    return falhar(`o diretório de ${absoluto} não existe; nada foi gravado.`);
  }
}

// lstat, não exists: um link simbólico (mesmo pendente) conta como existente e é recusado.
function lstatOuAusente(caminho) {
  try {
    return lstatSync(caminho);
  } catch (erro) {
    if (erro.code === 'ENOENT') return undefined;
    throw erro;
  }
}

function estadoDoAlvo(caminho) {
  const info = lstatOuAusente(caminho);
  if (!info) return 'ausente';
  if (!info.isFile()) {
    falhar(
      `${caminho} existe e não é um arquivo comum (link simbólico ou diretório); remova-o antes.`,
    );
  }
  return 'arquivo';
}

function estadoDoDiretorio(caminho) {
  const info = lstatOuAusente(caminho);
  if (!info) return 'ausente';
  if (!info.isDirectory()) {
    falhar(
      `${caminho} existe e não é um diretório comum (link simbólico ou arquivo); remova-o antes.`,
    );
  }
  return 'diretorio';
}

function gravarSoDono(caminho, conteudo) {
  writeFileSync(caminho, conteudo, { mode: PERMISSAO_SO_DONO, flag: 'wx' });
  chmodSync(caminho, PERMISSAO_SO_DONO);
}

// Fecha a permissão de um arquivo ou diretório que já existia (specs/014 §Segredos: arquivos 600;
// .secrets/ 700, task 023). O_NOFOLLOW: se o caminho virou link simbólico depois do lstat, a abertura
// falha em vez de mudar o modo do destino do link. Devolve true se o modo foi corrigido.
function fecharPermissao(caminho, permissao, { diretorio = false } = {}) {
  const tipo = diretorio ? constants.O_DIRECTORY : 0;
  let fd;
  try {
    fd = openSync(caminho, constants.O_RDONLY | constants.O_NOFOLLOW | tipo);
  } catch (erro) {
    if (erro.code === 'ELOOP' || erro.code === 'ENOTDIR') {
      falhar(`${caminho} virou link simbólico ou mudou de tipo; a permissão não foi alterada.`);
    }
    throw erro;
  }
  try {
    if ((fstatSync(fd).mode & 0o777) === permissao) return false;
    fchmodSync(fd, permissao);
    return true;
  } finally {
    closeSync(fd);
  }
}

const comCorrecao = (corrigida) => (corrigida ? { permissaoCorrigida: true } : {});

// Grava num temporário (permissão 600 desde a criação) e publica de forma atômica:
// sem sobrescrever, link() falha se o destino já existir; com sobrescrita, rename() troca o arquivo.
function gravarAtomico(caminho, temporario, conteudo, sobrescrever) {
  gravarSoDono(temporario, conteudo);
  try {
    if (sobrescrever) {
      renameSync(temporario, caminho);
      return;
    }
    linkSync(temporario, caminho);
  } finally {
    rmSync(temporario, { force: true });
  }
}

// Lê do .env.local existente só as senhas que viram arquivo. A mensagem de erro nunca cita valores.
function lerSenhasDoEnv(caminho) {
  const pares = new Map(
    readFileSync(caminho, 'utf8')
      .split('\n')
      .filter((linha) => linha.includes('=') && !linha.startsWith('#'))
      .map((linha) => [linha.slice(0, linha.indexOf('=')), linha.slice(linha.indexOf('=') + 1)]),
  );
  return Object.fromEntries(
    Object.keys(SEGREDOS_EM_ARQUIVO).map((variavel) => {
      const valor = pares.get(variavel) ?? '';
      if (!BASE64URL.test(valor)) {
        falhar(
          `${caminho}: ${variavel} ausente ou fora de base64url (A-Z a-z 0-9 - _). Corrija o` +
            ' arquivo ou regere todos os segredos com pnpm keys:generate --force.',
        );
      }
      return [variavel, valor];
    }),
  );
}

// Decide, sem gravar, o que fazer com cada arquivo de .secrets/: criar, manter (igual ao valor) ou
// sobrescrever (diferente; guarda o anterior em backup).
function planejarSegredos(diretorio, valores) {
  const diretorioExiste = estadoDoDiretorio(diretorio) === 'diretorio';
  return Object.entries(SEGREDOS_EM_ARQUIVO).map(([variavel, arquivo]) => {
    const caminho = join(diretorio, arquivo);
    const conteudo = valores[variavel];
    const existe = diretorioExiste && estadoDoAlvo(caminho) === 'arquivo';
    if (!existe) return { variavel, caminho, conteudo, acao: 'criado' };
    if (readFileSync(caminho, 'utf8') === conteudo) {
      return { variavel, caminho, conteudo, acao: 'mantido' };
    }
    return {
      variavel,
      caminho,
      conteudo,
      acao: 'sobrescrito',
      backup: nomeBackupDeSegredo(caminho),
    };
  });
}

const caminhosQueSeraoGravados = (plano) =>
  plano
    .filter((item) => item.acao !== 'mantido')
    .flatMap((item) => [item.caminho, nomeTemporario(item.caminho), item.backup].filter(Boolean));

// Cria .secrets/ com 700 ou fecha em 700 um que já existia. Devolve true se corrigiu a permissão.
function prepararDiretorioDeSegredos(diretorio) {
  if (estadoDoDiretorio(diretorio) === 'diretorio') {
    return fecharPermissao(diretorio, PERMISSAO_DIRETORIO_SO_DONO, { diretorio: true });
  }
  mkdirSync(diretorio, { mode: PERMISSAO_DIRETORIO_SO_DONO });
  chmodSync(diretorio, PERMISSAO_DIRETORIO_SO_DONO);
  return false;
}

function gravarSegredos(plano) {
  return plano.map(({ variavel, caminho, conteudo, acao, backup }) => {
    if (acao === 'mantido') {
      const corrigida = fecharPermissao(caminho, PERMISSAO_SO_DONO);
      return { variavel, caminho, status: acao, ...comCorrecao(corrigida) };
    }
    if (backup) gravarSoDono(backup, readFileSync(caminho));
    gravarAtomico(caminho, nomeTemporario(caminho), conteudo, acao === 'sobrescrito');
    return { variavel, caminho, status: acao, ...(backup ? { backup } : {}) };
  });
}

// Publica o .env.local. Corrida (outro processo criou o arquivo entre a checagem e o link()):
// vale o arquivo dele, e os arquivos de .secrets/ seguem os valores dele.
function publicarEnv(destino, conteudo, existia) {
  try {
    gravarAtomico(destino, nomeTemporario(destino), conteudo, existia);
    return true;
  } catch (erro) {
    if (erro.code === 'EEXIST' && !existia) return false;
    throw erro;
  }
}

// Nomes (nunca valores) das variáveis presentes num .env.local.
function nomesNoEnv(conteudo) {
  return new Set(
    conteudo
      .split('\n')
      .filter((linha) => linha.includes('=') && !linha.startsWith('#'))
      .map((linha) => linha.slice(0, linha.indexOf('=')).trim()),
  );
}

// Um .env.local anterior a uma variável nova (por exemplo, DB_API_PASSWORD da task 042) ganha só as
// linhas que faltam, no fim: o conteúdo existente fica byte a byte como estava, sem --force. A troca
// é atômica (temporário 600 + rename). Devolve os nomes acrescentados, nunca os valores.
async function acrescentarFaltantes(base, destino) {
  const atual = readFileSync(destino, 'utf8');
  const presentes = nomesNoEnv(atual);
  const faltantes = VARIAVEIS.filter((nome) => !presentes.has(nome));
  if (faltantes.length === 0) return [];
  const temporario = nomeTemporario(destino);
  garantirNaoVersionaveis(base, [destino, temporario]);
  const novos = await gerarSegredos();
  const separador = atual === '' || atual.endsWith('\n') ? '' : '\n';
  const linhas = faltantes.map((nome) => `${nome}=${novos[nome]}\n`).join('');
  gravarAtomico(destino, temporario, `${atual}${separador}${linhas}`, true);
  return faltantes;
}

// Nomes (nunca valores) das variáveis obsoletas presentes num .env.local mantido.
function obsoletasNoEnv(caminho) {
  const nomes = nomesNoEnv(readFileSync(caminho, 'utf8'));
  const presentes = VARIAVEIS_OBSOLETAS.filter((nome) => nomes.has(nome));
  return presentes.length > 0 ? presentes : undefined;
}

/**
 * Cria o arquivo de segredos e os arquivos de senha em `.secrets/` (ao lado dele). Sem `forcar`, o
 * conteúdo de um .env.local existente nunca é alterado (só a permissão, se não for 600), e os
 * arquivos de `.secrets/` são criados ou sincronizados a partir dele; com `forcar`, tudo é regerado e
 * os anteriores vão para backup (600). Arquivos e diretório que já existiam voltam a 600 e 700.
 * Recusa destino versionável pelo git e links simbólicos. `uid` existe para os testes.
 * @returns {Promise<{status: 'criado' | 'mantido' | 'sobrescrito', caminho: string, backup?: string,
 *   permissaoCorrigida?: true, acrescentadas?: string[], obsoletas?: string[], donoDiferenteDaApi?: true,
 *   diretorioDeSegredos: {caminho: string, permissaoCorrigida?: true},
 *   segredos: Array<{variavel: string, caminho: string, status: string, backup?: string,
 *     permissaoCorrigida?: true}>}>}
 */
export async function gerarEnvLocal({
  caminho = CAMINHO_PADRAO,
  forcar = false,
  uid = process.getuid?.(),
} = {}) {
  const destino = resolverDestino(caminho);
  const base = dirname(destino);
  const diretorioDeSegredos = join(base, DIRETORIO_DE_SEGREDOS);
  const existia = estadoDoAlvo(destino) === 'arquivo';
  const manterEnv = existia && !forcar;
  const novos = manterEnv ? undefined : await gerarSegredos();
  const plano = planejarSegredos(diretorioDeSegredos, manterEnv ? lerSenhasDoEnv(destino) : novos);
  const backupDoEnv = existia && !manterEnv ? nomeBackup(destino) : undefined;
  const doEnv = manterEnv ? [] : [destino, nomeTemporario(destino), backupDoEnv].filter(Boolean);
  const aGravar = [...doEnv, ...caminhosQueSeraoGravados(plano)];
  if (aGravar.length > 0) garantirNaoVersionaveis(base, aGravar);

  let status = manterEnv ? 'mantido' : existia ? 'sobrescrito' : 'criado';
  let planoFinal = plano;
  if (!manterEnv) {
    if (backupDoEnv) gravarSoDono(backupDoEnv, readFileSync(destino));
    if (!publicarEnv(destino, montarConteudo(novos), existia)) {
      status = 'mantido';
      planoFinal = planejarSegredos(diretorioDeSegredos, lerSenhasDoEnv(destino));
      garantirNaoVersionaveis(base, caminhosQueSeraoGravados(planoFinal));
    }
  }
  const acrescentadas = status === 'mantido' ? await acrescentarFaltantes(base, destino) : [];
  const envCorrigido = status === 'mantido' && fecharPermissao(destino, PERMISSAO_SO_DONO);
  const obsoletas = status === 'mantido' ? obsoletasNoEnv(destino) : undefined;
  const diretorioCorrigido = prepararDiretorioDeSegredos(diretorioDeSegredos);
  const segredos = gravarSegredos(planoFinal);
  const backup = status === 'sobrescrito' ? backupDoEnv : undefined;
  return {
    status,
    caminho: destino,
    ...(backup ? { backup } : {}),
    ...comCorrecao(envCorrigido),
    ...(acrescentadas.length > 0 ? { acrescentadas } : {}),
    ...(obsoletas ? { obsoletas } : {}),
    ...(uid !== undefined && uid !== UID_DA_API ? { donoDiferenteDaApi: true } : {}),
    diretorioDeSegredos: { caminho: diretorioDeSegredos, ...comCorrecao(diretorioCorrigido) },
    segredos,
  };
}

const OPCOES_CLI = Object.freeze({
  force: { type: 'boolean', default: false },
  // Destino alternativo, usado pelos testes; precisa estar fora do repositório ou ignorado pelo git.
  // Os arquivos de senha vão para `.secrets/` no mesmo diretório.
  out: { type: 'string' },
});

function lerArgumentos(argv) {
  const { values } = parseArgs({ args: argv, options: OPCOES_CLI, strict: true });
  return { forcar: values.force, caminho: values.out ?? CAMINHO_PADRAO };
}

function exibir(caminho) {
  const relativo = relative(realpathSync(RAIZ), caminho);
  return relativo.startsWith('..') ? caminho : relativo;
}

const permissao = (modo, corrigida) =>
  corrigida ? `permissão corrigida para ${modo}` : `permissão ${modo}`;

function mensagemDosSegredos({ diretorioDeSegredos, segredos, donoDiferenteDaApi }) {
  const diretorio = `  - ${exibir(diretorioDeSegredos.caminho)} (diretório, ${permissao('700', diretorioDeSegredos.permissaoCorrigida)})`;
  const linhas = segredos.map(({ caminho, status, backup, permissaoCorrigida }) => {
    const anterior = backup ? `; anterior em ${exibir(backup)}` : '';
    return `  - ${exibir(caminho)} (${status}, ${permissao('600', permissaoCorrigida)}${anterior})`;
  });
  // Um bind mount de arquivo segue o inode antigo até o container reiniciar; `up -d` não recria
  // o container por mudança no conteúdo do segredo.
  const regravou = segredos.some(({ status }) => status === 'sobrescrito');
  const aviso = regravou
    ? [
        'Um Redis em execução só lê o arquivo novo ao reiniciar: docker compose restart redis' +
          ' (pnpm infra:up não recria o container). O Postgres só lê a senha ao criar o volume:' +
          ' com o volume de dev já existente, rode pnpm db:sync-password.',
      ]
    : [];
  const dono = donoDiferenteDaApi
    ? [
        `Aviso: o dono dos arquivos é o seu usuário, não o uid ${UID_DA_API} da imagem da API. Em dev` +
          ' a API roda no host e lê o .env.local; só o infra/docker-compose.prod.yml local fica sem' +
          ' conseguir ler .secrets/ (o Compose ignora uid e mode de secrets com file:).',
      ]
    : [];
  return [
    `Arquivos de senha para o Compose (secrets:):`,
    diretorio,
    ...linhas,
    ...aviso,
    ...dono,
  ].join('\n');
}

function mensagemDasObsoletas({ caminho, obsoletas }) {
  if (!obsoletas) return [];
  return [
    `Atenção: ${exibir(caminho)} ainda define ${obsoletas.join(', ')}, que saíram do keys:generate` +
      ' (ADR 0023). Em dev elas sobrescrevem o .env (SEED_DEMO_PASSWORD fica no .env, e o keyId é' +
      ' derivado da chave pública): apague essas linhas do arquivo.',
  ];
}

function mensagemDoEnv({ status, caminho, backup, permissaoCorrigida, acrescentadas }) {
  const nome = exibir(caminho);
  if (status === 'mantido' && acrescentadas) {
    return [
      `${nome} já existe: as linhas existentes não foram alteradas; acrescentado só o que faltava:`,
      ...acrescentadas.map((variavel) => `  - ${variavel}`),
      'Rode pnpm db:migrate para aplicar a senha nova ao papel leilao_api.',
    ].join('\n');
  }
  if (status === 'mantido') {
    const correcao = permissaoCorrigida ? ' (só a permissão foi corrigida para 600)' : '';
    return `${nome} já existe e não foi alterado${correcao}. Para regerar todos os segredos: pnpm keys:generate --force`;
  }
  const lista = VARIAVEIS.map((variavel) => `  - ${variavel}`).join('\n');
  const criado = `${nome} ${status} (permissão 600) com:\n${lista}`;
  if (status !== 'sobrescrito') return criado;
  return [
    criado,
    `Arquivo anterior guardado em ${exibir(backup)} (permissão 600, ignorado pelo git).`,
    'Atenção: a chave Ed25519 antiga só existe nesse backup; sem ela, lances e selos já assinados',
    'deixam de ser verificáveis. O Postgres só lê DB_PASSWORD ao criar o volume: se ele já existia,',
    'rode pnpm db:sync-password (aplica a senha nova sem apagar o volume). A senha do papel leilao_api',
    '(DB_API_PASSWORD) é aplicada pelo pnpm db:migrate.',
  ].join('\n');
}

const mensagem = (resultado) =>
  [
    mensagemDoEnv(resultado),
    ...mensagemDasObsoletas(resultado),
    mensagemDosSegredos(resultado),
  ].join('\n');

async function main() {
  let argumentos;
  try {
    argumentos = lerArgumentos(process.argv.slice(2));
  } catch (erro) {
    console.error(`keys:generate: ${erro.message}`);
    console.error('Uso: pnpm keys:generate [--force]');
    process.exitCode = 2;
    return;
  }
  const resultado = await gerarEnvLocal(argumentos);
  console.log(mensagem(resultado));
}

if (import.meta.main) {
  main().catch((erro) => {
    // Só a mensagem do erro: as mensagens montadas aqui citam caminhos, nunca valores.
    console.error(`keys:generate falhou: ${erro.message}`);
    process.exitCode = 1;
  });
}
