#!/usr/bin/env node
// `pnpm keys:generate`: cria o .env.local com os segredos de desenvolvimento (task 010).
// Fonte: specs/014 §Segredos e ADR 0015 (dev usa .env.local; prod usa o GCP Secret Manager).
// Nunca imprime valores: a saída lista só os nomes das variáveis.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, linkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import * as ed from '@noble/ed25519';

const RAIZ = resolve(import.meta.dirname, '..');
const CAMINHO_PADRAO = join(RAIZ, '.env.local');

const BYTES_256_BITS = 32;
// 15 bytes viram 20 caracteres base64url, dentro da regra de senha do cadastro (specs/003 RF-01).
const BYTES_SENHA_DEMO = 15;
// ED25519_KEY_ID: 16 hex (64 bits) do SHA-256 da chave pública; identifica a chave na rotação (specs/008).
const HEX_DO_KEY_ID = 16;
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

// Grava num temporário (permissão 600 desde a criação) e publica de forma atômica:
// sem sobrescrever, link() falha se o destino já existir; com sobrescrita, rename() troca o arquivo.
// O nome do temporário casa com `.env.*.local` do .gitignore caso o processo morra no meio.
function gravarAtomico(caminho, conteudo, sobrescrever) {
  const temporario = join(dirname(caminho), `.env.tmp-${process.pid}-${basename(caminho)}.local`);
  writeFileSync(temporario, conteudo, { mode: PERMISSAO_SO_DONO, flag: 'wx' });
  try {
    chmodSync(temporario, PERMISSAO_SO_DONO);
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
 * Cria o arquivo de segredos. Sem `forcar`, um arquivo existente nunca é alterado.
 * @returns {Promise<{status: 'criado' | 'mantido' | 'sobrescrito', caminho: string}>}
 */
export async function gerarEnvLocal({ caminho = CAMINHO_PADRAO, forcar = false } = {}) {
  const existia = existsSync(caminho);
  if (existia && !forcar) return { status: 'mantido', caminho };
  const conteudo = montarConteudo(await gerarSegredos());
  try {
    gravarAtomico(caminho, conteudo, forcar);
  } catch (erro) {
    // Corrida: outro processo criou o arquivo entre a checagem e o link().
    if (erro.code === 'EEXIST' && !forcar) return { status: 'mantido', caminho };
    throw erro;
  }
  return { status: existia ? 'sobrescrito' : 'criado', caminho };
}

const OPCOES_CLI = Object.freeze({
  force: { type: 'boolean', default: false },
  // Destino alternativo, usado pelos testes; o padrão é o .env.local da raiz do repositório.
  out: { type: 'string' },
});

function lerArgumentos(argv) {
  const { values } = parseArgs({ args: argv, options: OPCOES_CLI, strict: true });
  return { forcar: values.force, caminho: values.out ? resolve(values.out) : CAMINHO_PADRAO };
}

function mensagem({ status, caminho }) {
  const nome = caminho === CAMINHO_PADRAO ? '.env.local' : caminho;
  if (status === 'mantido') {
    return `${nome} já existe; nada foi alterado. Para regerar todos os segredos: pnpm keys:generate --force`;
  }
  const lista = VARIAVEIS.map((variavel) => `  - ${variavel}`).join('\n');
  const aviso =
    status === 'sobrescrito'
      ? '\nAtenção: o Postgres só lê DB_PASSWORD ao criar o volume. Se ele já existia, recrie-o' +
        ' (docker compose down -v) ou troque a senha no banco antes de subir de novo.'
      : '';
  return `${nome} ${status} (permissão 600) com:\n${lista}${aviso}`;
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
    // Só a mensagem do erro: nenhum valor gerado chega aqui.
    console.error(`keys:generate falhou: ${erro.message}`);
    process.exitCode = 1;
  });
}
