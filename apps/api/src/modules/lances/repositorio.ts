// Acesso às tabelas do módulo lances: bids, lot_seals e signing_keys (specs/007 §Dados, specs/008
// §Dados). Nenhum outro módulo lê estas tabelas. Privilégios do papel da API (ADR 0026): só SELECT
// e INSERT nas três (append-only, com trigger). O banco não impõe a cadeia: a ordem correta é de
// quem chama (cadeia.ts), dentro da transação com o lote travado.
import { and, count, countDistinct, desc, eq, max } from 'drizzle-orm';

import type { BancoDrizzle, Transacao } from '../../db/banco.js';
import { bids, lotSeals, signingKeys } from './schema.js';

/** Banco fora de transação ou uma transação. */
export type Executor = BancoDrizzle | Transacao;

/** Último elo gravado da cadeia de um lote; `hash` em hex minúsculo. */
export interface UltimoLance {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
}

/** Linha nova de `bids`; hashes em hex, assinatura em base64url (specs/008 §Codificações). */
export interface LinhaDoLance {
  readonly loteId: string;
  readonly seq: number;
  readonly licitanteId: string;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: Date;
  readonly hashAnterior: string;
  readonly hash: string;
  readonly assinatura: string;
  readonly keyId: string;
  readonly idempotencyKey: string;
}

/** Linha nova de `lot_seals`. */
export interface LinhaDoSelo {
  readonly loteId: string;
  readonly status: 'encerrado' | 'cancelado';
  readonly totalLances: number;
  readonly hashFinal: string;
  readonly vencedorPseudonimo: string | null;
  readonly valorArremateCentavos: number | null;
  readonly seladoEm: Date;
  readonly assinatura: string;
  readonly keyId: string;
}

const deHex = (hex: string): Buffer => Buffer.from(hex, 'hex');
const deBase64url = (texto: string): Buffer => Buffer.from(texto, 'base64url');

/**
 * Lance de maior `seq` do lote, ou `null` se ainda não há lance (gênese). Usa o índice do unique
 * `(lote_id, seq)` em varredura reversa.
 */
export async function lerUltimoLance(tx: Transacao, loteId: string): Promise<UltimoLance | null> {
  const [linha] = await tx
    .select({
      id: bids.id,
      seq: bids.seq,
      hash: bids.hash,
      pseudonimo: bids.pseudonimo,
      valorCentavos: bids.valorCentavos,
    })
    .from(bids)
    .where(eq(bids.loteId, loteId))
    .orderBy(desc(bids.seq))
    .limit(1);
  if (linha === undefined) return null;
  return { ...linha, hash: linha.hash.toString('hex') };
}

/** Lance já gravado com a `Idempotency-Key` do licitante (idempotência, specs/007). */
export interface LanceDaChave {
  readonly loteId: string;
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: Date;
}

/** Lance do licitante com a chave, em qualquer lote, ou `null` (unique `(licitante_id, chave)`). */
export async function buscarLancePorChave(
  tx: Transacao,
  licitanteId: string,
  idempotencyKey: string,
): Promise<LanceDaChave | null> {
  const [linha] = await tx
    .select({
      loteId: bids.loteId,
      seq: bids.seq,
      pseudonimo: bids.pseudonimo,
      valorCentavos: bids.valorCentavos,
      criadoEm: bids.criadoEm,
    })
    .from(bids)
    .where(and(eq(bids.licitanteId, licitanteId), eq(bids.idempotencyKey, idempotencyKey)));
  return linha ?? null;
}

/** Lance como o histórico o mostra: sem `id`, sem licitante, sem hashes. */
export interface LinhaDoHistorico {
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: Date;
}

/** Lote em que o usuário deu lance, com os agregados dos lances dele. */
export interface LoteDoUsuario {
  readonly loteId: string;
  readonly meuMaiorLanceCentavos: number;
  readonly meuUltimoLanceEm: Date;
}

/** Janela de uma página: `limite` linhas a partir de `deslocamento`. */
export interface JanelaDePagina {
  readonly limite: number;
  readonly deslocamento: number;
}

/** Total de lances do lote (índice do unique `(lote_id, seq)`). */
export async function contarLancesDoLote(db: Executor, loteId: string): Promise<number> {
  const [linha] = await db.select({ total: count() }).from(bids).where(eq(bids.loteId, loteId));
  return linha?.total ?? 0;
}

/** Lances do lote por `seq` decrescente (varredura reversa do unique `(lote_id, seq)`). */
export async function listarLancesDoLote(
  db: Executor,
  loteId: string,
  janela: JanelaDePagina,
): Promise<LinhaDoHistorico[]> {
  return db
    .select({
      seq: bids.seq,
      pseudonimo: bids.pseudonimo,
      valorCentavos: bids.valorCentavos,
      criadoEm: bids.criadoEm,
    })
    .from(bids)
    .where(eq(bids.loteId, loteId))
    .orderBy(desc(bids.seq))
    .limit(janela.limite)
    .offset(janela.deslocamento);
}

/** O usuário tem ao menos um lance no lote? (índice `(licitante_id, lote_id)`). */
export async function usuarioTemLanceNoLote(
  db: Executor,
  loteId: string,
  usuarioId: string,
): Promise<boolean> {
  const [linha] = await db
    .select({ seq: bids.seq })
    .from(bids)
    .where(and(eq(bids.loteId, loteId), eq(bids.licitanteId, usuarioId)))
    .limit(1);
  return linha !== undefined;
}

/** Quantos lotes distintos têm lance do usuário (índice `(licitante_id, lote_id)`). */
export async function contarLotesDoUsuario(db: Executor, usuarioId: string): Promise<number> {
  const [linha] = await db
    .select({ total: countDistinct(bids.loteId) })
    .from(bids)
    .where(eq(bids.licitanteId, usuarioId));
  return linha?.total ?? 0;
}

/**
 * Um item por lote com lance do usuário, do lance mais recente ao mais antigo (desempate por
 * `lote_id` decrescente), numa consulta só: o agrupamento percorre o índice do usuário.
 */
export async function listarLotesDoUsuario(
  db: Executor,
  usuarioId: string,
  janela: JanelaDePagina,
): Promise<LoteDoUsuario[]> {
  const ultimo = max(bids.criadoEm);
  const linhas = await db
    .select({
      loteId: bids.loteId,
      meuMaiorLanceCentavos: max(bids.valorCentavos),
      meuUltimoLanceEm: ultimo,
    })
    .from(bids)
    .where(eq(bids.licitanteId, usuarioId))
    .groupBy(bids.loteId)
    .orderBy(desc(ultimo), desc(bids.loteId))
    .limit(janela.limite)
    .offset(janela.deslocamento);
  return linhas.map((linha) => {
    // max() de colunas NOT NULL de um grupo não vazio nunca é nulo.
    if (linha.meuMaiorLanceCentavos === null || linha.meuUltimoLanceEm === null) {
      throw new Error('agregado de lances do usuário nulo');
    }
    return {
      loteId: linha.loteId,
      meuMaiorLanceCentavos: linha.meuMaiorLanceCentavos,
      meuUltimoLanceEm: linha.meuUltimoLanceEm,
    };
  });
}

/** Insere o lance e devolve o `id` (UUIDv7 do default `uuidv7()`). */
export async function inserirLance(tx: Transacao, linha: LinhaDoLance): Promise<string> {
  const [inserido] = await tx
    .insert(bids)
    .values({
      loteId: linha.loteId,
      seq: linha.seq,
      licitanteId: linha.licitanteId,
      pseudonimo: linha.pseudonimo,
      valorCentavos: linha.valorCentavos,
      criadoEm: linha.criadoEm,
      hashAnterior: deHex(linha.hashAnterior),
      hash: deHex(linha.hash),
      assinatura: deBase64url(linha.assinatura),
      keyId: linha.keyId,
      idempotencyKey: linha.idempotencyKey,
    })
    .returning({ id: bids.id });
  if (inserido === undefined) throw new Error('insert em bids não devolveu o id');
  return inserido.id;
}

/** Insere o selo do lote (a PK `lote_id` recusa um segundo selo). */
export async function inserirSelo(tx: Transacao, linha: LinhaDoSelo): Promise<void> {
  await tx.insert(lotSeals).values({
    loteId: linha.loteId,
    status: linha.status,
    totalLances: linha.totalLances,
    hashFinal: deHex(linha.hashFinal),
    vencedorPseudonimo: linha.vencedorPseudonimo,
    valorArremateCentavos: linha.valorArremateCentavos,
    seladoEm: linha.seladoEm,
    assinatura: deBase64url(linha.assinatura),
    keyId: linha.keyId,
  });
}

/**
 * `INSERT ... ON CONFLICT (key_id) DO NOTHING` da chave pública (specs/008 §Chaves) e devolve a
 * chave gravada sob o `keyId`: a do primeiro registro, que `ativa_desde` também não muda.
 */
export async function registrarChavePublica(
  db: Executor,
  keyId: string,
  chavePublica: Uint8Array,
): Promise<Buffer | null> {
  await db
    .insert(signingKeys)
    .values({ keyId, chavePublica: Buffer.from(chavePublica) })
    .onConflictDoNothing({ target: signingKeys.keyId });
  const [linha] = await db
    .select({ chavePublica: signingKeys.chavePublica })
    .from(signingKeys)
    .where(eq(signingKeys.keyId, keyId));
  return linha?.chavePublica ?? null;
}
