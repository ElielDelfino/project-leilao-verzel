// Acesso a `lots` (specs/006 §Dados). O papel da API tem SELECT e INSERT na tabela e UPDATE só
// nas colunas de COLUNAS_ATUALIZAVEIS (ADR 0026). "Agora" é o now() do Postgres (specs/006
// §Estados e status derivado).
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import type { BancoDrizzle, Transacao } from '../../db/banco.js';
import {
  escaparLike,
  type FiltrosDaVitrine,
  type OrdemDaVitrine,
  type StatusDaVitrine,
} from './esquemas-da-vitrine.js';
import { lots } from './schema.js';

export type StatusDoLote = 'agendado' | 'ao_vivo' | 'encerrado' | 'cancelado';

/** Status derivado dos horários, usado na resposta, nos filtros e na ordenação. */
export const statusDerivado = sql<StatusDoLote>`case
  when ${lots.status} = 'cancelado' then 'cancelado'
  when ${lots.status} = 'encerrado' or ${lots.fimEm} <= now() then 'encerrado'
  when now() < ${lots.inicioEm} then 'agendado'
  else 'ao_vivo' end`;

/** Colunas do resumo `Lote` (openapi.yaml). Nenhuma identifica usuário. */
const COLUNAS_DO_LOTE = {
  id: lots.id,
  titulo: lots.titulo,
  status: statusDerivado,
  cartaNome: lots.cartaNome,
  raridade: lots.raridade,
  snapshotId: lots.snapshotId,
  inicioEm: lots.inicioEm,
  fimEm: lots.fimEm,
  lanceInicialCentavos: lots.lanceInicialCentavos,
  incrementoMinimoCentavos: lots.incrementoMinimoCentavos,
  lanceAtualCentavos: lots.lanceAtualCentavos,
  totalLances: lots.totalLances,
  valorArremateCentavos: lots.valorArremateCentavos,
  criadoEm: lots.criadoEm,
};

export interface LinhaDoLote {
  readonly id: string;
  readonly titulo: string;
  readonly status: StatusDoLote;
  readonly cartaNome: string;
  readonly raridade: string;
  readonly snapshotId: string;
  readonly inicioEm: Date;
  readonly fimEm: Date;
  readonly lanceInicialCentavos: number;
  readonly incrementoMinimoCentavos: number;
  readonly lanceAtualCentavos: number | null;
  readonly totalLances: number;
  readonly valorArremateCentavos: number | null;
  readonly criadoEm: Date;
}

export interface NovoLote {
  readonly leiloeiroId: string;
  readonly snapshotId: string;
  readonly cartaNome: string;
  readonly raridade: string;
  readonly titulo: string;
  readonly descricao: string | null;
  readonly lanceInicialCentavos: number;
  readonly incrementoMinimoCentavos: number;
  readonly inicioEm: Date;
  readonly fimEm: Date;
}

export interface LinhaDoResumo {
  readonly totalRecebidoCentavos: number;
  readonly lotesArrematados: number;
  readonly lotesSemLance: number;
}

/** INSERT com o status gravado pelo now() da transação: `ao_vivo` se já começou (specs/006). */
export async function inserirLote(tx: Transacao, novo: NovoLote): Promise<LinhaDoLote> {
  const inicio = novo.inicioEm.toISOString();
  const [linha] = await tx
    .insert(lots)
    .values({
      ...novo,
      fimOriginalEm: novo.fimEm,
      status: sql`(case when ${inicio}::timestamptz <= now()
        then 'ao_vivo' else 'agendado' end)::status_lote`,
    })
    .returning(COLUNAS_DO_LOTE);
  if (linha === undefined) throw new Error('insert em lots não devolveu a linha');
  return linha;
}

export async function contarLotesDoLeiloeiro(
  db: BancoDrizzle,
  leiloeiroId: string,
): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(lots)
    .where(eq(lots.leiloeiroId, leiloeiroId));
  return linha?.total ?? 0;
}

/** Do mais recente ao mais antigo, desempate por id (índice lots_leiloeiro_id_criado_em_id_idx). */
export async function listarLotesDoLeiloeiro(
  db: BancoDrizzle,
  leiloeiroId: string,
  pagina: { readonly limite: number; readonly deslocamento: number },
): Promise<LinhaDoLote[]> {
  return db
    .select(COLUNAS_DO_LOTE)
    .from(lots)
    .where(eq(lots.leiloeiroId, leiloeiroId))
    .orderBy(desc(lots.criadoEm), desc(lots.id))
    .limit(pagina.limite)
    .offset(pagina.deslocamento);
}

/** Preço da faixa e da ordem `maior_lance` (specs/006 §Vitrine). */
const preco = sql<number>`coalesce(${lots.lanceAtualCentavos}, ${lots.lanceInicialCentavos})`;

/** Ainda não encerrado nem cancelado pelo status gravado. */
const abertoPeloStatusGravado = inArray(lots.status, ['agendado', 'ao_vivo']);

/**
 * Status derivado escrito como predicados sobre as colunas (equivalente a `statusDerivado = x`),
 * para o planner usar os índices (status, inicio_em) e (status, fim_em). Sem status: tudo menos
 * cancelado.
 */
function condicaoDoStatus(status: StatusDaVitrine | null): SQL | undefined {
  switch (status) {
    case 'agendado':
      return and(
        abertoPeloStatusGravado,
        gt(lots.inicioEm, sql`now()`),
        gt(lots.fimEm, sql`now()`),
      );
    case 'ao_vivo':
      return and(
        abertoPeloStatusGravado,
        lte(lots.inicioEm, sql`now()`),
        gt(lots.fimEm, sql`now()`),
      );
    case 'encerrado':
      return or(
        eq(lots.status, 'encerrado'),
        and(abertoPeloStatusGravado, lte(lots.fimEm, sql`now()`)),
      );
    case null:
      return ne(lots.status, 'cancelado');
  }
}

function condicaoDaVitrine(filtros: FiltrosDaVitrine): SQL | undefined {
  const padrao = filtros.q === null ? null : `%${escaparLike(filtros.q)}%`;
  return and(
    condicaoDoStatus(filtros.status),
    padrao === null ? undefined : or(ilike(lots.titulo, padrao), ilike(lots.cartaNome, padrao)),
    filtros.precoMin === null ? undefined : sql`${preco} >= ${filtros.precoMin}`,
    filtros.precoMax === null ? undefined : sql`${preco} <= ${filtros.precoMax}`,
    filtros.raridade === null ? undefined : eq(lots.raridade, filtros.raridade),
  );
}

const ORDENACOES: Readonly<Record<OrdemDaVitrine, readonly SQL[]>> = {
  termina_antes: [asc(lots.fimEm), desc(lots.id)],
  mais_recente: [desc(lots.criadoEm), desc(lots.id)],
  maior_lance: [desc(preco), desc(lots.id)],
};

export async function contarLotesDaVitrine(
  db: BancoDrizzle,
  filtros: FiltrosDaVitrine,
): Promise<number> {
  const [linha] = await db.select({ total: count() }).from(lots).where(condicaoDaVitrine(filtros));
  return linha?.total ?? 0;
}

/** Página da vitrine; o desempate por id decrescente deixa a paginação estável. */
export async function listarLotesDaVitrine(
  db: BancoDrizzle,
  filtros: FiltrosDaVitrine,
  pagina: { readonly limite: number; readonly deslocamento: number },
): Promise<LinhaDoLote[]> {
  return db
    .select(COLUNAS_DO_LOTE)
    .from(lots)
    .where(condicaoDaVitrine(filtros))
    .orderBy(...ORDENACOES[filtros.ordem])
    .limit(pagina.limite)
    .offset(pagina.deslocamento);
}

export interface LinhaDoDetalhe extends LinhaDoLote {
  readonly descricao: string | null;
  readonly fimOriginalEm: Date;
  /** Só para calcular `suaPosicao`; nunca vai para a resposta. */
  readonly liderId: string | null;
  readonly vencedorId: string | null;
}

/** Qualquer status, inclusive cancelado (specs/006 §Detalhe); `id` já é UUID. */
export async function lerLoteDoDetalhe(
  db: BancoDrizzle,
  id: string,
): Promise<LinhaDoDetalhe | undefined> {
  const [linha] = await db
    .select({
      ...COLUNAS_DO_LOTE,
      descricao: lots.descricao,
      fimOriginalEm: lots.fimOriginalEm,
      liderId: lots.liderId,
      vencedorId: lots.vencedorId,
    })
    .from(lots)
    .where(eq(lots.id, id));
  return linha;
}

/** Só lotes com status gravado `encerrado` (gravado pelo job, specs/010). */
export async function lerResumoDoLeiloeiro(
  db: BancoDrizzle,
  leiloeiroId: string,
): Promise<LinhaDoResumo> {
  const [linha] = await db
    .select({
      totalRecebidoCentavos: sql<number>`coalesce(sum(${lots.valorArremateCentavos})
        filter (where ${lots.vencedorId} is not null), 0)::bigint`.mapWith(Number),
      lotesArrematados: sql<number>`count(*) filter (where ${lots.vencedorId} is not null)`.mapWith(
        Number,
      ),
      lotesSemLance: sql<number>`count(*) filter (where ${lots.totalLances} = 0)`.mapWith(Number),
    })
    .from(lots)
    .where(and(eq(lots.leiloeiroId, leiloeiroId), eq(lots.status, 'encerrado')));
  return linha ?? { totalRecebidoCentavos: 0, lotesArrematados: 0, lotesSemLance: 0 };
}
