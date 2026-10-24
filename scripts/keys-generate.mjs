#!/usr/bin/env node
// `pnpm keys:generate`: cria o .env.local com os segredos de desenvolvimento (task 010).
// Fonte: specs/014 §Segredos e ADR 0015 (dev usa .env.local; prod usa o GCP Secret Manager).
// Nunca imprime valores: a saída lista só nomes de variáveis e caminhos de arquivos.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  lstatSync,
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

const BYTES_256_BITS = 32;
// 15 bytes viram 20 caracteres base64url, dentro da regra de senha do cadastro (specs/003 RF-01).
const BYTES_SENHA_DEMO = 15;
// ED25519_KEY_ID: 16 hex (64 bits) do SHA-256 da chave pública; identifica a chave na rotação (specs/008).
const HEX_DO_KEY_ID = 16;
// Sufixo aleatório do backup: dois --force no mesmo milissegundo não colidem.
const BYTES_SUFIXO_BACKUP = 3;
const PERMISSAO_SO_DONO = 0o600;

export const VARIAVEIS = Object.freeze([
  'DB_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_SECRET',
  'PSEUDONYM_HMAC_KEY',
  'ED25519_PRIVATE_KEY',
  'ED25519_KEY_ID',
  'SEED_DEMO_PASSWORD',
]);

const aleatorioBase64url = (bytes) => randomBytes(bytes).toString('base64url');

async function gerarSegredos() {
  const { secretKey, publicKey } = await ed.keygenAsync();
  return Object.freeze({
    DB_PASSWORD: aleatorioBase64url(BYTES_256_BITS),
    REDIS_PASSWORD: aleatorioBase64url(BYTES_256_BITS),
    JWT_SECRET: aleatorioBase64url(BYTES_256_BITS),
    PSEUDONYM_HMAC_KEY: aleatorioBase64url(BYTES_256_BITS),
    ED25519_PRIVATE_KEY: Buffer.from(secretKey).toString('base64url'),
    ED25519_KEY_ID: createHash('sha256').update(publicKey).digest('hex').slice(0, HEX_DO_KEY_ID),
    SEED_DEMO_PASSWORD: aleatorioBase64url(BYTES_SENHA_DEMO),
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

export function nomeBackup(caminho, agora = new Date()) {
  const carimbo = agora.toISOString().replace(/[:.]/g, '-');
  const sufixo = randomBytes(BYTES_SUFIXO_BACKUP).toString('hex');
  return join(dirname(caminho), `.env.bak-${carimbo}-${sufixo}.local`);
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
// versionável). Na dúvida, falha fechada.
function versionavel(caminho) {
  const diretorio = dirname(caminho);
  const nome = basename(caminho);
  const arvore = rodarGit(diretorio, ['rev-parse', '--is-inside-work-tree']);
  if (arvore.status !== 0) {
    if (/not a git repository/.test(arvore.stderr)) return false;
    falhar(`não foi possível checar o git em ${diretorio}: ${arvore.stderr.trim()}`);
  }
  if (arvore.stdout.trim() !== 'true') return false;
  const ignorado = rodarGit(diretorio, ['check-ignore', '-q', '--', nome]);
  if (ignorado.status === 0) return false;
  if (ignorado.status === 1) return true;
  falhar(`git check-ignore falhou para ${caminho}: ${ignorado.stderr.trim()}`);
}

function garantirNaoVersionaveis(caminhos) {
  for (const caminho of caminhos) {
    if (versionavel(caminho)) {
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
function estadoDoAlvo(caminho) {
  let info;
  try {
    info = lstatSync(caminho);
  } catch (erro) {
    if (erro.code === 'ENOENT') return 'ausente';
    throw erro;
  }
  if (!info.isFile()) {
    falhar(
      `${caminho} existe e não é um arquivo comum (link simbólico ou diretório); remova-o antes.`,
    );
  }
  return 'arquivo';
}

function gravarSoDono(caminho, conteudo) {
  writeFileSync(caminho, conteudo, { mode: PERMISSAO_SO_DONO, flag: 'wx' });
  chmodSync(caminho, PERMISSAO_SO_DONO);
}

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

/**
 * Cria o arquivo de segredos. Sem `forcar`, um arquivo existente nunca é alterado; com `forcar`,
 * o anterior é guardado em `backup` (600) antes de ser trocado. Recusa destino versionável pelo git.
 * @returns {Promise<{status: 'criado' | 'mantido' | 'sobrescrito', caminho: string, backup?: string}>}
 */
export async function gerarEnvLocal({ caminho = CAMINHO_PADRAO, forcar = false } = {}) {
  const destino = resolverDestino(caminho);
  const existia = estadoDoAlvo(destino) === 'arquivo';
  if (existia && !forcar) return { status: 'mantido', caminho: destino };
  const temporario = nomeTemporario(destino);
  const backup = existia ? nomeBackup(destino) : undefined;
  garantirNaoVersionaveis([destino, temporario, ...(backup ? [backup] : [])]);
  const conteudo = montarConteudo(await gerarSegredos());
  if (backup) gravarSoDono(backup, readFileSync(destino));
  try {
    gravarAtomico(destino, temporario, conteudo, existia);
  } catch (erro) {
    // Corrida: outro processo criou o arquivo entre a checagem e o link().
    if (erro.code === 'EEXIST' && !existia) return { status: 'mantido', caminho: destino };
    throw erro;
  }
  if (!existia) return { status: 'criado', caminho: destino };
  return { status: 'sobrescrito', caminho: destino, backup };
}

const OPCOES_CLI = Object.freeze({
  force: { type: 'boolean', default: false },
  // Destino alternativo, usado pelos testes; precisa estar fora do repositório ou ignorado pelo git.
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

function mensagem({ status, caminho, backup }) {
  const nome = exibir(caminho);
  if (status === 'mantido') {
    return `${nome} já existe; nada foi alterado. Para regerar todos os segredos: pnpm keys:generate --force`;
  }
  const lista = VARIAVEIS.map((variavel) => `  - ${variavel}`).join('\n');
  const criado = `${nome} ${status} (permissão 600) com:\n${lista}`;
  if (status !== 'sobrescrito') return criado;
  return [
    criado,
    `Arquivo anterior guardado em ${exibir(backup)} (permissão 600, ignorado pelo git).`,
    'Atenção: a chave Ed25519 antiga só existe nesse backup; sem ela, lances e selos já assinados',
    'deixam de ser verificáveis. O Postgres só lê DB_PASSWORD ao criar o volume: se ele já existia,',
    'recrie-o (docker compose down -v) ou troque a senha no banco antes de subir de novo.',
  ].join('\n');
}

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
