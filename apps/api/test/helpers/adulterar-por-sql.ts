// Adulteração do histórico por SQL, só para testes (tarefa 089; specs/008 §Verificação). Quem altera
// `bids` aqui é o dono do esquema (a conexão do teste) com os triggers append-only desligados, e só
// dentro de uma transação: o `alter table … disable/enable trigger` é transacional, então nenhuma
// outra sessão vê o trigger desligado e, em qualquer falha, o rollback devolve tudo ao que era.
// Para forjar uma cadeia (inserir lance, recalcular hashes) o helper assina com uma chave que NÃO
// está em `signing_keys`, como faria quem não tem a chave privada do servidor.
import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import {
  assinar,
  type ChavesDeAssinatura,
} from '../../src/modules/lances/integridade/assinatura.js';
import { hashDoLance, hashGenese } from '../../src/modules/lances/integridade/hash.js';

/** Papel de privilégio mínimo da API (migration 0001, ADR 0026). */
export const PAPEL_DA_API = 'leilao_api';

export type TabelaDeIntegridade = 'bids' | 'lot_seals' | 'signing_keys';
export const TABELAS_DE_INTEGRIDADE: readonly TabelaDeIntegridade[] = [
  'bids',
  'lot_seals',
  'signing_keys',
];

const TABELAS_VALIDAS: ReadonlySet<string> = new Set(TABELAS_DE_INTEGRIDADE);

/** Confere em runtime que o nome está na lista fechada, antes de ele entrar num SQL. */
export function validarTabelaDeIntegridade(valor: string): TabelaDeIntegridade {
  if (!TABELAS_VALIDAS.has(valor)) {
    throw new Error(`tabela fora da lista de integridade: ${JSON.stringify(valor)}`);
  }
  return valor as TabelaDeIntegridade;
}

export interface EstadoDeTrigger {
  readonly tabela: string;
  readonly nome: string;
  /** `pg_trigger.tgenabled`: `O` = habilitado (origin), `D` = desabilitado. */
  readonly habilitado: string;
}

/** Lance como gravado em `bids`, já nas codificações que a auditoria publica. */
export interface LinhaDeLance {
  readonly id: string;
  readonly seq: number;
  readonly licitanteId: string;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: string;
  readonly hashAnterior: string;
  readonly hash: string;
  readonly assinatura: string;
  readonly keyId: string;
}

/**
 * Roda `fn` com os triggers de usuário das `tabelas` desligados, tudo numa transação: commit só se
 * `fn` e o religamento passarem; qualquer falha faz rollback (o que restaura os triggers e desfaz as
 * alterações) e a conexão volta ao pool, ou é descartada se nem o rollback funcionou. Com `tabelas`
 * vazio é só uma transação. Desligue só as tabelas que o caso altera: o `alter table` pega
 * SHARE ROW EXCLUSIVE e bloqueia escritas de outros arquivos de teste enquanto durar.
 */
export async function adulterarPorSql<T>(
  pool: pg.Pool,
  tabelas: readonly TabelaDeIntegridade[],
  fn: (cliente: pg.PoolClient) => Promise<T>,
): Promise<T> {
  // Ordem fixa: duas adulterações em paralelo pegam os locks na mesma ordem (sem deadlock).
  const validas = tabelas.map((t) => validarTabelaDeIntegridade(t));
  const ordenadas = TABELAS_DE_INTEGRIDADE.filter((t) => validas.includes(t));
  const cliente = await pool.connect();
  let descartar = false;
  try {
    await cliente.query('begin');
    for (const tabela of ordenadas) {
      await cliente.query(`alter table ${tabela} disable trigger user`);
    }
    const resultado = await fn(cliente);
    for (const tabela of ordenadas) {
      await cliente.query(`alter table ${tabela} enable trigger user`);
    }
    await cliente.query('commit');
    return resultado;
  } catch (erro: unknown) {
    await cliente.query('rollback').catch(() => {
      descartar = true;
    });
    throw erro;
  } finally {
    cliente.release(descartar);
  }
}

/**
 * Roda `fn` numa transação do dono que NUNCA confirma (rollback sempre): para provar o que o banco
 * recusa sem deixar rastro. Cada comando que deve falhar usa {@link codigoDaFalha}.
 */
export async function emTransacaoDesfeita(
  pool: pg.Pool,
  fn: (cliente: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const cliente = await pool.connect();
  let descartar = false;
  try {
    await cliente.query('begin');
    await fn(cliente);
  } finally {
    await cliente.query('rollback').catch(() => {
      descartar = true;
    });
    cliente.release(descartar);
  }
}

/** Passa a executar como o papel da API até o fim da transação (`set local role`). */
export async function assumirPapelDaApi(cliente: pg.ClientBase): Promise<void> {
  await cliente.query(`set local role ${PAPEL_DA_API}`);
}

/**
 * Roda o comando num savepoint e devolve o SQLSTATE da falha. Se o comando passar, lança: um
 * UPDATE que deveria ser recusado e funcionou é falha do teste, não resultado.
 */
export async function codigoDaFalha(
  cliente: pg.ClientBase,
  comando: string,
  parametros: readonly unknown[] = [],
): Promise<string | undefined> {
  return (await falhaDe(cliente, comando, parametros)).codigo;
}

/** Como {@link codigoDaFalha}, mas devolve também a mensagem do erro do Postgres. */
export async function falhaDe(
  cliente: pg.ClientBase,
  comando: string,
  parametros: readonly unknown[] = [],
): Promise<{ readonly codigo: string | undefined; readonly mensagem: string }> {
  await cliente.query('savepoint tentativa');
  try {
    await cliente.query(comando, [...parametros]);
  } catch (erro: unknown) {
    await cliente.query('rollback to savepoint tentativa');
    if (erro instanceof Error && 'code' in erro) {
      return { codigo: String(erro.code), mensagem: erro.message };
    }
    throw erro;
  }
  throw new Error(`o comando deveria ter falhado: ${comando}`);
}

/** Triggers de usuário das três tabelas de integridade, por tabela e nome. */
export async function estadoDosTriggers(pool: pg.Pool): Promise<EstadoDeTrigger[]> {
  const { rows } = await pool.query<EstadoDeTrigger>(
    `select c.relname as tabela, t.tgname as nome, t.tgenabled::text as habilitado
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'public'::regnamespace and c.relname = any($1::text[])
        and not t.tgisinternal
      order by c.relname, t.tgname`,
    [[...TABELAS_DE_INTEGRIDADE]],
  );
  return rows;
}

interface LinhaCrua {
  id: string;
  seq: number;
  licitante_id: string;
  pseudonimo: string;
  valor_centavos: string;
  criado_em: Date;
  hash_anterior: Buffer;
  hash: Buffer;
  assinatura: Buffer;
  key_id: string;
}

/** Cadeia do lote por `seq`, como está gravada agora. */
export async function lerCadeia(cliente: pg.ClientBase, loteId: string): Promise<LinhaDeLance[]> {
  const { rows } = await cliente.query<LinhaCrua>(
    `select id, seq, licitante_id, pseudonimo, valor_centavos::text as valor_centavos, criado_em,
            hash_anterior, hash, assinatura, key_id
       from bids where lote_id = $1 order by seq`,
    [loteId],
  );
  return rows.map((l) => ({
    id: l.id,
    seq: l.seq,
    licitanteId: l.licitante_id,
    pseudonimo: l.pseudonimo,
    valorCentavos: Number(l.valor_centavos),
    criadoEm: l.criado_em.toISOString(),
    hashAnterior: l.hash_anterior.toString('hex'),
    hash: l.hash.toString('hex'),
    assinatura: l.assinatura.toString('base64url'),
    keyId: l.key_id,
  }));
}

/** {@link lerCadeia} numa conexão emprestada do pool (leitura fora de qualquer adulteração). */
export async function lerCadeiaDoPool(pool: pg.Pool, loteId: string): Promise<LinhaDeLance[]> {
  const cliente = await pool.connect();
  try {
    return await lerCadeia(cliente, loteId);
  } finally {
    cliente.release();
  }
}

/** Altera só `valor_centavos` do lance; hash e assinatura ficam como estavam. */
export async function alterarValorDoLance(
  cliente: pg.ClientBase,
  loteId: string,
  seq: number,
  valorCentavos: number,
): Promise<void> {
  const { rowCount } = await cliente.query(
    'update bids set valor_centavos = $3::bigint where lote_id = $1 and seq = $2',
    [loteId, seq, valorCentavos],
  );
  if (rowCount !== 1) throw new Error(`lance ${seq} do lote ${loteId} não existe`);
}

/** Apaga os lances de `seqs` (um só `delete`, para a contagem conferir). */
export async function apagarLances(
  cliente: pg.ClientBase,
  loteId: string,
  seqs: readonly number[],
): Promise<void> {
  const { rowCount } = await cliente.query(
    'delete from bids where lote_id = $1 and seq = any($2::int[])',
    [loteId, [...seqs]],
  );
  if (rowCount !== seqs.length) throw new Error(`esperava apagar ${seqs.length} lances`);
}

export interface LanceAssinado {
  readonly loteId: string;
  readonly licitanteId: string;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  /** Quem assina: a chave de quem forja, ou a chave nova de uma rotação simulada. */
  readonly chaves: ChavesDeAssinatura;
  /** `key_id` gravado; padrão: o da própria `chaves`. A FK exige que esteja em `signing_keys`. */
  readonly keyId?: string;
  /** Padrão: o seguinte ao último lance. Um valor maior abre um buraco na sequência. */
  readonly seq?: number;
}

/**
 * Insere um lance encadeado no último hash gravado (ou na gênese), com hash correto e assinatura
 * de `chaves`; devolve a linha gravada. Não precisa desligar trigger (INSERT é permitido).
 */
export async function inserirLanceAssinado(
  cliente: pg.ClientBase,
  lance: LanceAssinado,
): Promise<LinhaDeLance> {
  const ultimo = (await lerCadeia(cliente, lance.loteId)).at(-1);
  const seq = lance.seq ?? (ultimo?.seq ?? 0) + 1;
  const criadoEm = new Date().toISOString();
  const hashAnterior = ultimo?.hash ?? hashGenese(lance.loteId);
  const hash = hashDoLance({
    loteId: lance.loteId,
    seq,
    pseudonimo: lance.pseudonimo,
    valorCentavos: lance.valorCentavos,
    criadoEm,
    hashAnterior,
  });
  const assinatura = assinar(lance.chaves.chavePrivada, hash);
  const keyId = lance.keyId ?? lance.chaves.keyId;
  const { rows } = await cliente.query<{ id: string }>(
    `insert into bids (lote_id, seq, licitante_id, pseudonimo, valor_centavos, criado_em,
       hash_anterior, hash, assinatura, key_id, idempotency_key)
     values ($1, $2, $3, $4, $5::bigint, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      lance.loteId,
      seq,
      lance.licitanteId,
      lance.pseudonimo,
      lance.valorCentavos,
      criadoEm,
      Buffer.from(hashAnterior, 'hex'),
      Buffer.from(hash, 'hex'),
      Buffer.from(assinatura, 'base64url'),
      keyId,
      randomUUID(),
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert em bids não devolveu o id');
  return {
    id,
    seq,
    licitanteId: lance.licitanteId,
    pseudonimo: lance.pseudonimo,
    valorCentavos: lance.valorCentavos,
    criadoEm,
    hashAnterior,
    hash,
    assinatura,
    keyId,
  };
}

/**
 * Muda o valor do lance `aPartirDoSeq` e recalcula `hashAnterior`, `hash` e `assinatura` dele e de
 * todos os seguintes, de modo que a cadeia fique coerente por dentro. Quem faz isso não tem a chave
 * privada: assina com `chaves`, e o `key_id` gravado segue o do servidor (specs/008 §Verificação 4).
 */
export async function recalcularCadeiaSemAChave(
  cliente: pg.ClientBase,
  loteId: string,
  alteracao: {
    readonly aPartirDoSeq: number;
    readonly valorCentavos: number;
    readonly chaves: ChavesDeAssinatura;
  },
): Promise<void> {
  let anterior = hashGenese(loteId);
  for (const linha of await lerCadeia(cliente, loteId)) {
    if (linha.seq < alteracao.aPartirDoSeq) {
      anterior = linha.hash;
      continue;
    }
    const valorCentavos =
      linha.seq === alteracao.aPartirDoSeq ? alteracao.valorCentavos : linha.valorCentavos;
    const hash = hashDoLance({
      loteId,
      seq: linha.seq,
      pseudonimo: linha.pseudonimo,
      valorCentavos,
      criadoEm: linha.criadoEm,
      hashAnterior: anterior,
    });
    const assinatura = assinar(alteracao.chaves.chavePrivada, hash);
    await cliente.query(
      `update bids set valor_centavos = $2::bigint, hash_anterior = $3, hash = $4, assinatura = $5
        where id = $1`,
      [
        linha.id,
        valorCentavos,
        Buffer.from(anterior, 'hex'),
        Buffer.from(hash, 'hex'),
        Buffer.from(assinatura, 'base64url'),
      ],
    );
    anterior = hash;
  }
}
