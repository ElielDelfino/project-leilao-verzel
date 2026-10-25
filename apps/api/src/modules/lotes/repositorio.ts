// Acesso a `lots` (specs/006 §Dados). O papel da API tem SELECT e INSERT na tabela e UPDATE só
// nas colunas de COLUNAS_ATUALIZAVEIS (ADR 0026). "Agora" é o now() do Postgres (specs/006
// §Estados e status derivado).
import { and, count, desc, eq, sql } from 'drizzle-orm';

import type { BancoDrizzle, Transacao } from '../../db/banco.js';
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
