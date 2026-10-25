// Tabela do módulo lotes (specs/006 §Dados, tarefa 051). Migration: 0002_catalogo_lotes.
// Dinheiro em centavos, bigint no banco e `number` na API, como no ledger (ADR 0001).
//
// O que fica só no SQL da migration (a fronteira de módulos impede declarar aqui, specs/001
// §Módulos: lotes não importa identidade nem catalogo):
// - FKs leiloeiro_id, lider_id e vencedor_id → users(id) e snapshot_id → card_snapshots(id), sem
//   CASCADE (nada disso é excluído, ADR 0001);
// - o GRANT ao papel da API (ADR 0026): SELECT e INSERT na tabela e UPDATE só nas colunas que
//   mudam depois da criação (COLUNAS_ATUALIZAVEIS); sem DELETE (o cancelamento muda o status).
//
// CHECKs nas invariantes da criação (specs/006 §Criação) e nas de dinheiro e prazo que valem
// depois dela: lance atual ≥ lance inicial, arremate > 0, total de lances ≥ 0 e fim_em ≥
// fim_original_em (o anti-sniping só estende, specs/007). O fim_em não tem CHECK de duração
// máxima porque o anti-sniping o estende; os limites de título e descrição ficam na API.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { statusLote } from '../../db/schema.js';

/** Lance inicial e incremento mínimo: de R$ 1,00 a R$ 1.000.000,00 (specs/006 §Criação). */
export const CENTAVOS_MINIMO_DO_LOTE = 100;
export const CENTAVOS_MAXIMO_DO_LOTE = 100_000_000;

/** Duração original do lote (fim_original_em − inicio_em): de 5 minutos a 7 dias. */
export const DURACAO_MINIMA = '5 minutes';
export const DURACAO_MAXIMA = '7 days';

/** Colunas com GRANT UPDATE ao leilao_api (SQL da migration 0002); o resto é imutável. */
export const COLUNAS_ATUALIZAVEIS = [
  'fim_em',
  'status',
  'lance_atual_centavos',
  'lider_id',
  'total_lances',
  'vencedor_id',
  'valor_arremate_centavos',
  'encerrado_em',
  'cancelado_em',
] as const;

const minimo = sql.raw(String(CENTAVOS_MINIMO_DO_LOTE));
const maximo = sql.raw(String(CENTAVOS_MAXIMO_DO_LOTE));

export const lots = pgTable(
  'lots',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    leiloeiroId: uuid('leiloeiro_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    // Copiados do snapshot na criação (imutáveis): a vitrine busca e filtra sem JOIN com
    // card_snapshots, que é de catalogo.
    cartaNome: text('carta_nome').notNull(),
    raridade: text('raridade').notNull(),
    titulo: text('titulo').notNull(),
    descricao: text('descricao'),
    lanceInicialCentavos: bigint('lance_inicial_centavos', { mode: 'number' }).notNull(),
    incrementoMinimoCentavos: bigint('incremento_minimo_centavos', { mode: 'number' }).notNull(),
    inicioEm: timestamp('inicio_em', { withTimezone: true }).notNull(),
    fimEm: timestamp('fim_em', { withTimezone: true }).notNull(),
    fimOriginalEm: timestamp('fim_original_em', { withTimezone: true }).notNull(),
    status: statusLote('status').notNull(),
    lanceAtualCentavos: bigint('lance_atual_centavos', { mode: 'number' }),
    liderId: uuid('lider_id'),
    totalLances: integer('total_lances').notNull().default(0),
    vencedorId: uuid('vencedor_id'),
    valorArremateCentavos: bigint('valor_arremate_centavos', { mode: 'number' }),
    encerradoEm: timestamp('encerrado_em', { withTimezone: true }),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Um snapshot pertence a um único lote (specs/005 RF-02); o unique também indexa a FK.
    unique('lots_snapshot_id_unique').on(t.snapshotId),
    check(
      'lots_lance_inicial_faixa',
      sql`${t.lanceInicialCentavos} between ${minimo} and ${maximo}`,
    ),
    check(
      'lots_incremento_minimo_faixa',
      sql`${t.incrementoMinimoCentavos} between ${minimo} and ${maximo}`,
    ),
    check(
      'lots_duracao_minima',
      sql`${t.fimOriginalEm} >= ${t.inicioEm} + interval '${sql.raw(DURACAO_MINIMA)}'`,
    ),
    check(
      'lots_duracao_maxima',
      sql`${t.fimOriginalEm} - ${t.inicioEm} <= interval '${sql.raw(DURACAO_MAXIMA)}'`,
    ),
    // Depois da criação: o lance atual nunca fica abaixo do inicial (specs/007), o arremate é
    // positivo, o contador não fica negativo e o anti-sniping só adia o fim.
    check(
      'lots_lance_atual_minimo',
      sql`${t.lanceAtualCentavos} is null or ${t.lanceAtualCentavos} >= ${t.lanceInicialCentavos}`,
    ),
    check(
      'lots_valor_arremate_positivo',
      sql`${t.valorArremateCentavos} is null or ${t.valorArremateCentavos} > 0`,
    ),
    check('lots_total_lances_nao_negativo', sql`${t.totalLances} >= 0`),
    check('lots_fim_nao_recua', sql`${t.fimEm} >= ${t.fimOriginalEm}`),
    // Encerramento (job de 1 s, specs/010) e vitrine "termina antes" (specs/006 RF-03).
    index('lots_status_fim_em_idx').on(t.status, t.fimEm),
    // Abertura dos agendados (specs/010) e vitrine filtrada por status.
    index('lots_status_inicio_em_idx').on(t.status, t.inicioEm),
    // Painel do leiloeiro: `order by criado_em desc, id desc` (specs/006); também indexa a FK.
    index('lots_leiloeiro_id_criado_em_id_idx').on(
      t.leiloeiroId,
      t.criadoEm.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // Busca de texto por título ou carta com ILIKE (specs/006 RF-03); pg_trgm vem da 0000.
    index('lots_titulo_trgm_idx').using('gin', t.titulo.op('gin_trgm_ops')),
    index('lots_carta_nome_trgm_idx').using('gin', t.cartaNome.op('gin_trgm_ops')),
  ],
);
