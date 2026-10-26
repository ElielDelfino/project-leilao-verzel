#!/usr/bin/env node
// `pnpm demo:adulterar --lote <id> --seq <n>` (task 123, specs/008 §Interfaces): ferramenta de
// DEMONSTRAÇÃO. Soma 1 centavo ao `valor_centavos` do lance `<seq>` direto no banco, sem recalcular
// hash nem assinatura, para mostrar que a auditoria detecta a adulteração. Restaura com
// `pnpm demo:adulterar --lote <id> --seq <n> --restaurar --valor <centavos>`.
//
// Segurança:
// - recusa antes de conectar: NODE_ENV=production, ausência do opt-in explícito `DEMO_ADULTERAR=1`
//   (task 138) e host fora de loopback (o serviço `postgres` do compose NÃO é aceito: é o host do
//   banco na VPS, onde o script nunca roda);
// - conecta como DONO do banco (POSTGRES_USER/DB_PASSWORD[_FILE]); o papel da API não tem UPDATE
//   em bids e o trigger append-only recusa até o dono, por isso o trigger é desabilitado;
// - o `DISABLE TRIGGER` vive só dentro de uma transação que o reabilita (DDL é transacional: em
//   qualquer falha o ROLLBACK devolve o trigger), com `SET LOCAL lock_timeout`;
// - nunca imprime segredo: erros de banco saem só com o código SQLSTATE.
//
// `pg` vem de apps/api (sem dependência nova na raiz); a escolha vai no relatório da tarefa.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = resolve(import.meta.dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEIRO = /^[0-9]{1,16}$/;
// bids_valor_faixa (migration 0003): 100 a Number.MAX_SAFE_INTEGER.
const VALOR_MINIMO = 100n;
const VALOR_MAXIMO = BigInt(Number.MAX_SAFE_INTEGER);
const HOSTS_LOCAIS = new Set(['127.0.0.1', '::1', 'localhost']);
const LOCK_TIMEOUT = '5s';
const TRIGGER = 'bids_append_only';
const USO =
  'Uso: DEMO_ADULTERAR=1 pnpm demo:adulterar --lote <uuid> --seq <n>\n' +
  '     DEMO_ADULTERAR=1 pnpm demo:adulterar --lote <uuid> --seq <n> --restaurar --valor <centavos>';

export class ErroDeUso extends Error {
  name = 'ErroDeUso';
}

/** Lê os argumentos; lança ErroDeUso com mensagem clara se faltarem ou forem inválidos. */
export function lerArgumentos(argv) {
  const valores = new Map();
  let restaurar = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      continue; // o pnpm pode repassar o separador
    } else if (arg === '--restaurar') {
      restaurar = true;
    } else if (arg === '--lote' || arg === '--seq' || arg === '--valor') {
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) {
        throw new ErroDeUso(`${arg} exige um valor.`);
      }
      if (valores.has(arg)) {
        throw new ErroDeUso(`${arg} repetido.`);
      }
      valores.set(arg, valor);
      i += 1;
    } else {
      throw new ErroDeUso(`Argumento desconhecido: ${arg}`);
    }
  }
  const lote = valores.get('--lote');
  if (lote === undefined || !UUID.test(lote)) {
    throw new ErroDeUso('--lote é obrigatório e deve ser um UUID.');
  }
  const seq = valores.get('--seq');
  if (seq === undefined || !INTEIRO.test(seq) || BigInt(seq) < 1n || BigInt(seq) > 2147483647n) {
    throw new ErroDeUso('--seq é obrigatório e deve ser um inteiro >= 1.');
  }
  const valor = valores.get('--valor');
  if (restaurar) {
    if (valor === undefined || !INTEIRO.test(valor)) {
      throw new ErroDeUso('--restaurar exige --valor <centavos> (inteiro).');
    }
    const centavos = BigInt(valor);
    if (centavos < VALOR_MINIMO || centavos > VALOR_MAXIMO) {
      throw new ErroDeUso(`--valor fora da faixa de lances (${VALOR_MINIMO} a ${VALOR_MAXIMO}).`);
    }
  } else if (valor !== undefined) {
    throw new ErroDeUso('--valor só vale junto com --restaurar.');
  }
  return Object.freeze({
    lote: lote.toLowerCase(),
    seq: Number(seq),
    restaurar,
    valor: restaurar ? BigInt(valor) : undefined,
  });
}

/** Recusa ambiente que não seja local. Lança ErroDeUso; roda antes de qualquer conexão. */
export function exigirAmbienteLocal(env) {
  if (env.NODE_ENV === 'production') {
    throw new ErroDeUso('Recusado: NODE_ENV=production. O script é só para dev/demo.');
  }
  if (env.DEMO_ADULTERAR !== '1') {
    throw new ErroDeUso(
      'Recusado: falta o opt-in explícito. Rode com DEMO_ADULTERAR=1 (só na máquina de dev/demo, nunca na VPS).',
    );
  }
  const host = env.POSTGRES_HOST;
  if (host === undefined || host === '') {
    throw new ErroDeUso('POSTGRES_HOST ausente (carregue .env e .env.local).');
  }
  if (!HOSTS_LOCAIS.has(host)) {
    throw new ErroDeUso(
      'Recusado: POSTGRES_HOST fora de loopback (127.0.0.1, ::1, localhost). O script é só para dev/demo.',
    );
  }
}

function lerSenha(env) {
  if (env.DB_PASSWORD !== undefined && env.DB_PASSWORD !== '') {
    return env.DB_PASSWORD;
  }
  const arquivo = env.DB_PASSWORD_FILE;
  if (arquivo === undefined || arquivo === '') {
    throw new ErroDeUso('DB_PASSWORD (ou DB_PASSWORD_FILE) ausente.');
  }
  try {
    return readFileSync(arquivo, 'utf8').trim();
  } catch {
    throw new ErroDeUso('DB_PASSWORD_FILE ilegível.');
  }
}

/** Conexão do dono do banco; `password` não enumerável para não vazar em log ou inspect. */
export function lerConexaoDoDono(env) {
  const faltando = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER'].filter(
    (nome) => env[nome] === undefined || env[nome] === '',
  );
  if (faltando.length > 0) {
    throw new ErroDeUso(`Variáveis ausentes: ${faltando.join(', ')}.`);
  }
  const porta = Number(env.POSTGRES_PORT);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new ErroDeUso('POSTGRES_PORT inválida.');
  }
  const conexao = {
    host: env.POSTGRES_HOST,
    port: porta,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
  };
  Object.defineProperty(conexao, 'password', { value: lerSenha(env), enumerable: false });
  return conexao;
}

function carregarPg() {
  const requerer = createRequire(resolve(RAIZ, 'apps/api/package.json'));
  return requerer('pg');
}

/**
 * Altera o lance numa única transação. Devolve `{anterior, novo}` (BigInt) ou lança ErroDeUso se o
 * lote ou o seq não existir. `cliente` é um pg.Client já conectado.
 */
export async function adulterar(cliente, { lote, seq, restaurar, valor }) {
  await cliente.query('BEGIN');
  try {
    await cliente.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const lance = await cliente.query(
      'SELECT valor_centavos::text AS valor FROM bids WHERE lote_id = $1 AND seq = $2',
      [lote, seq],
    );
    if (lance.rowCount === 0) {
      const existe = await cliente.query('SELECT 1 FROM lots WHERE id = $1', [lote]);
      throw new ErroDeUso(
        existe.rowCount === 0 ? 'Lote inexistente.' : `O lote não tem o lance seq ${seq}.`,
      );
    }
    const anterior = BigInt(lance.rows[0].valor);
    const novo = restaurar ? valor : anterior + 1n;
    if (novo > VALOR_MAXIMO) {
      throw new ErroDeUso('O valor novo passaria do máximo permitido para um lance.');
    }
    await cliente.query(`ALTER TABLE bids DISABLE TRIGGER ${TRIGGER}`);
    await cliente.query('UPDATE bids SET valor_centavos = $3 WHERE lote_id = $1 AND seq = $2', [
      lote,
      seq,
      novo.toString(),
    ]);
    await cliente.query(`ALTER TABLE bids ENABLE TRIGGER ${TRIGGER}`);
    const estado = await cliente.query(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = $1 AND tgrelid = 'public.bids'::regclass",
      [TRIGGER],
    );
    if (estado.rows[0]?.tgenabled !== 'O') {
      throw new Error('O trigger append-only não voltou habilitado; transação desfeita.');
    }
    await cliente.query('COMMIT');
    return { anterior, novo };
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  }
}

export async function main(argv, env, saida = console) {
  const argumentos = lerArgumentos(argv);
  exigirAmbienteLocal(env);
  const conexao = lerConexaoDoDono(env);
  const { Client } = carregarPg();
  const cliente = new Client(conexao);
  await cliente.connect();
  try {
    const { anterior, novo } = await adulterar(cliente, argumentos);
    const ref = `lote ${argumentos.lote}, seq ${argumentos.seq}`;
    if (argumentos.restaurar) {
      saida.log(`Restaurado (${ref}): valor_centavos ${anterior} -> ${novo}.`);
    } else {
      saida.log(`Adulterado (${ref}): valor_centavos ${anterior} -> ${novo}.`);
      saida.log(`Valor original: ${anterior} centavos. Para restaurar:`);
      saida.log(
        `  pnpm demo:adulterar --lote ${argumentos.lote} --seq ${argumentos.seq} --restaurar --valor ${anterior}`,
      );
    }
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).catch((erro) => {
    if (erro instanceof ErroDeUso) {
      console.error(`${erro.message}\n${USO}`);
    } else {
      // Só o SQLSTATE: a mensagem do driver pode citar host, usuário ou comando.
      console.error(`Falha ao falar com o banco${erro?.code ? ` (código ${erro.code})` : ''}.`);
    }
    process.exitCode = 1;
  });
}
