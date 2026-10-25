#!/usr/bin/env node
// `pnpm db:sync-password` (task 023): aplica no volume de dev do Postgres a senha de
// .secrets/db_password. O Postgres só lê POSTGRES_PASSWORD_FILE ao criar o volume, então depois de um
// `pnpm keys:generate --force` o banco continua com a senha antiga (erro 28P01 na API). Decisão do
// humano (2026-10-25): trocar com ALTER ROLE pelo socket do container, sem apagar o volume.
//
// O segredo nunca vai para argv, log ou saída:
// - o ALTER ROLE recebe um verificador SCRAM-SHA-256 calculado aqui (o Postgres o guarda como está;
//   docs da versão 18, CREATE ROLE §PASSWORD), então nem o servidor nem um log de erro veem a senha;
// - o SQL vai pelo stdin do `docker exec`; a conferência por TCP lê a senha do stdin dentro do
//   container (PGPASSWORD só no ambiente do psql de lá);
// - as mensagens de erro do psql passam por `semSegredos` antes de chegar ao terminal.
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DIRETORIO_DE_SEGREDOS, SEGREDOS_EM_ARQUIVO, VARIAVEIS } from './keys-generate.mjs';

const RAIZ = resolve(import.meta.dirname, '..');
const ARQUIVO_DA_SENHA = join(DIRETORIO_DE_SEGREDOS, SEGREDOS_EM_ARQUIVO.DB_PASSWORD);
const SERVICO = 'postgres';
// Usuário do sistema dentro do container que roda o psql (sem capabilities efetivas).
const USUARIO_DO_SISTEMA = 'postgres';

// Padrões do Postgres 18: scram_iterations = 4096 e sal de 16 bytes; chaves SHA-256 de 32 bytes.
const ITERACOES_SCRAM = 4096;
const BYTES_DO_SAL = 16;
const BYTES_DA_CHAVE = 32;
// Formato dos segredos (ADR 0023 §Decisão, item 4): 43 caracteres base64url, forma canônica.
const SENHA_CANONICA = /^[A-Za-z0-9_-]{43}$/;
// Identificador simples do Postgres: o usuário entra no SQL entre aspas duplas, sem escape.
const IDENTIFICADOR = /^[a-z_][a-z0-9_]{0,62}$/;

// Conexão por TCP no IP do próprio container: o pg_hba da imagem aceita sem senha o socket e o
// 127.0.0.1, mas exige SCRAM do resto, então só esse caminho prova que a senha autentica.
const SCRIPT_DE_CONFERENCIA =
  'IFS= read -r PGPASSWORD && export PGPASSWORD && ' +
  'exec psql -X -A -t -w -h "$1" -U "$2" -d "$3" -c "select 1" >/dev/null';

const hmac = (chave, texto) => createHmac('sha256', chave).update(texto).digest();
const base64 = (bytes) => bytes.toString('base64');

/**
 * Verificador SCRAM-SHA-256 no formato do pg_authid (RFC 5803):
 * `SCRAM-SHA-256$<iterações>:<sal>$<StoredKey>:<ServerKey>`, com as chaves da RFC 5802 §3.
 * A senha é ASCII (base64url), então o SASLprep não a altera.
 */
export function verificadorScram(
  senha,
  { sal = randomBytes(BYTES_DO_SAL), iteracoes = ITERACOES_SCRAM } = {},
) {
  const salgada = pbkdf2Sync(senha, sal, iteracoes, BYTES_DA_CHAVE, 'sha256');
  const storedKey = createHash('sha256').update(hmac(salgada, 'Client Key')).digest();
  const serverKey = hmac(salgada, 'Server Key');
  return `SCRAM-SHA-256$${iteracoes}:${base64(sal)}$${base64(storedKey)}:${base64(serverKey)}`;
}

function falhar(mensagem) {
  throw new Error(mensagem);
}

const canonica = (valor) =>
  SENHA_CANONICA.test(valor) && Buffer.from(valor, 'base64url').toString('base64url') === valor;

function lerSenhaDoArquivo(raiz) {
  const caminho = join(raiz, ARQUIVO_DA_SENHA);
  let info;
  try {
    info = lstatSync(caminho);
  } catch {
    return falhar(`${ARQUIVO_DA_SENHA} não existe: rode pnpm keys:generate.`);
  }
  if (!info.isFile())
    falhar(`${ARQUIVO_DA_SENHA} não é um arquivo comum; remova-o e rode pnpm keys:generate.`);
  const senha = readFileSync(caminho, 'utf8');
  if (!canonica(senha)) {
    falhar(
      `${ARQUIVO_DA_SENHA} fora do formato (43 caracteres base64url, sem quebra de linha): apague-o` +
        ' e rode pnpm keys:generate.',
    );
  }
  return senha;
}

// Confere tudo antes de chamar o docker. As mensagens citam nomes, nunca valores.
function validarEntradas({ raiz, usuario, banco, senhaDoEnv }) {
  if (!IDENTIFICADOR.test(usuario ?? '')) {
    falhar('POSTGRES_USER ausente ou fora de [a-z_][a-z0-9_]* (confira o .env).');
  }
  if (!IDENTIFICADOR.test(banco ?? '')) {
    falhar('POSTGRES_DB ausente ou fora de [a-z_][a-z0-9_]* (confira o .env).');
  }
  if (!canonica(senhaDoEnv ?? '')) {
    falhar('DB_PASSWORD ausente ou fora do formato no .env.local: rode pnpm keys:generate.');
  }
  const senha = lerSenhaDoArquivo(raiz);
  if (senha !== senhaDoEnv) {
    falhar(
      `DB_PASSWORD do .env.local e ${ARQUIVO_DA_SENHA} divergem (a API usa o .env.local): rode` +
        ' pnpm keys:generate para sincronizar .secrets/ e depois este comando de novo.',
    );
  }
  return senha;
}

// Ambiente do docker sem os 5 segredos que o --env-file do .env.local pôs em process.env.
function ambienteSemSegredos() {
  const segredos = new Set(VARIAVEIS);
  const ambiente = Object.entries(process.env).filter(([nome]) => !segredos.has(nome));
  return { ...Object.fromEntries(ambiente), LC_ALL: 'C' };
}

function executarDocker(args, { entrada } = {}) {
  const saida = spawnSync('docker', args, {
    encoding: 'utf8',
    input: entrada ?? '',
    env: ambienteSemSegredos(),
  });
  if (saida.error) falhar(`não foi possível rodar o docker: ${saida.error.message}`);
  return saida;
}

// Tira do texto a senha e qualquer verificador SCRAM antes de mostrá-lo.
function semSegredos(texto, senha) {
  return (texto ?? '')
    .split(senha)
    .join('<omitido>')
    .replace(/SCRAM-SHA-256\$\S+/g, '<verificador omitido>')
    .trim();
}

function localizarContainer(raiz, executar) {
  const saida = executar([
    'compose',
    '--project-directory',
    raiz,
    '-f',
    join(raiz, 'docker-compose.yml'),
    '--env-file',
    join(raiz, '.env'),
    'ps',
    '-q',
    SERVICO,
  ]);
  if (saida.status !== 0) falhar(`docker compose ps falhou: ${(saida.stderr ?? '').trim()}`);
  const ids = saida.stdout.split('\n').filter(Boolean);
  if (ids.length === 0) falhar('o Postgres de dev não está rodando: suba com pnpm infra:up.');
  if (ids.length > 1)
    falhar('mais de um container do serviço postgres no projeto; nada foi alterado.');
  return ids[0];
}

function ipDoContainer(container, executar) {
  const formato = '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}';
  const saida = executar(['inspect', '--format', formato, container]);
  const ip = saida.status === 0 ? saida.stdout.split(/\s+/).find(Boolean) : undefined;
  return ip ?? falhar('não foi possível obter o IP do container do Postgres.');
}

function autentica({ container, ip, usuario, banco, senha, executar }) {
  const args = [
    'exec',
    '-i',
    '-u',
    USUARIO_DO_SISTEMA,
    container,
    'sh',
    '-c',
    SCRIPT_DE_CONFERENCIA,
  ];
  const saida = executar([...args, 'verificar', ip, usuario, banco], { entrada: `${senha}\n` });
  return saida.status === 0;
}

function trocarSenha({ container, usuario, banco, senha, executar }) {
  const sql = `ALTER ROLE "${usuario}" PASSWORD '${verificadorScram(senha)}';\n`;
  const psql = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', usuario, '-d', banco, '-f', '-'];
  const saida = executar(['exec', '-i', '-u', USUARIO_DO_SISTEMA, container, ...psql], {
    entrada: sql,
  });
  if (saida.status !== 0) falhar(`ALTER ROLE falhou: ${semSegredos(saida.stderr, senha)}`);
}

/**
 * Faz o Postgres de dev aceitar a senha de .secrets/db_password (igual à DB_PASSWORD do .env.local).
 * Se ela já autentica, não altera nada.
 * @returns {Promise<{status: 'ja-sincronizada' | 'sincronizada', container: string}>}
 */
export async function sincronizarSenha({
  raiz = RAIZ,
  usuario,
  banco,
  senhaDoEnv,
  executar = executarDocker,
}) {
  const senha = validarEntradas({ raiz, usuario, banco, senhaDoEnv });
  const container = localizarContainer(raiz, executar);
  const conexao = { container, ip: ipDoContainer(container, executar), usuario, banco, executar };
  if (autentica({ ...conexao, senha })) return { status: 'ja-sincronizada', container };
  trocarSenha({ ...conexao, senha });
  if (!autentica({ ...conexao, senha })) {
    falhar(
      `a senha de ${ARQUIVO_DA_SENHA} ainda não autentica no Postgres depois do ALTER ROLE;` +
        ' confira os logs do container (docker compose logs postgres).',
    );
  }
  return { status: 'sincronizada', container };
}

async function main() {
  const usuario = process.env.POSTGRES_USER;
  const resultado = await sincronizarSenha({
    usuario,
    banco: process.env.POSTGRES_DB,
    senhaDoEnv: process.env.DB_PASSWORD,
  });
  if (resultado.status === 'ja-sincronizada') {
    console.log(`O Postgres de dev já aceita a senha de ${ARQUIVO_DA_SENHA}; nada foi alterado.`);
    return;
  }
  console.log(
    [
      `Senha do usuário ${usuario} trocada no Postgres de dev pela de ${ARQUIVO_DA_SENHA}`,
      '(ALTER ROLE pelo socket do container, com verificador SCRAM-SHA-256) e conferida por TCP.',
      'Reinicie a API (pnpm dev) se ela estava rodando.',
    ].join('\n'),
  );
}

if (import.meta.main) {
  main().catch((erro) => {
    // As mensagens montadas aqui citam nomes e caminhos, nunca valores.
    console.error(`db:sync-password falhou: ${erro.message}`);
    process.exitCode = 1;
  });
}
