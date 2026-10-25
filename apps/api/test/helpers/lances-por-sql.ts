// Apoio por SQL dos testes de integração dos lances (tarefa 087): o relógio do lote é ajustado
// relativo ao `clock_timestamp()` do Postgres, o mesmo relógio que `agora(tx)` lê na transação do
// lance (specs/007 §Relógio), e o estado de `lots`, `bids` e `ledger_entries` é lido direto do banco.
import type pg from 'pg';

export interface EstadoDoLote {
  readonly total: number;
  readonly liderId: string | null;
  readonly lanceAtualCentavos: number | null;
  readonly fimEm: Date;
  readonly fimOriginalEm: Date;
}

export interface ContagemDoLote {
  readonly lances: number;
  readonly lancamentos: number;
}

/**
 * Faz o lote terminar daqui a `deslocamentoMs` (relativo ao relógio do Postgres, ao milissegundo).
 * `fim_original_em` acompanha, para valer `fim_em ≥ fim_original_em`, e o início recua para manter
 * a duração mínima de 5 min (CHECK `lots_duracao_minima`). Só para lotes ainda sem lance.
 */
export async function terminarEm(
  pool: pg.Pool,
  loteId: string,
  deslocamentoMs: number,
): Promise<void> {
  await pool.query(
    `update lots
        set inicio_em = fim.t - interval '1 hour',
            fim_original_em = fim.t,
            fim_em = fim.t
       from (select date_trunc('milliseconds', clock_timestamp())
                    + make_interval(secs => $2::double precision / 1000) as t) as fim
      where lots.id = $1`,
    [loteId, deslocamentoMs],
  );
}

/**
 * Encerra o lote como o job de encerramento da F4 deixaria: fim vencido, com o status gravado e o
 * vencedor dados. Sem `vencedorId`, o `vencedor_id` fica nulo (lote vencido e ainda não apurado).
 */
export async function encerrarPorSql(
  pool: pg.Pool,
  loteId: string,
  gravado: { status: 'ao_vivo' | 'encerrado' | 'cancelado'; vencedorId?: string },
): Promise<void> {
  await pool.query(
    `update lots
        set inicio_em = now() - interval '2 hours',
            fim_original_em = now() - interval '1 minute',
            fim_em = now() - interval '1 minute',
            status = $2::status_lote,
            vencedor_id = $3,
            valor_arremate_centavos = case when $3::uuid is null then null
                                           else lance_atual_centavos end
      where id = $1`,
    [loteId, gravado.status, gravado.vencedorId ?? null],
  );
}

export async function estadoDoLote(pool: pg.Pool, loteId: string): Promise<EstadoDoLote> {
  const { rows } = await pool.query<{
    total_lances: number;
    lider_id: string | null;
    lance_atual_centavos: string | null;
    fim_em: Date;
    fim_original_em: Date;
  }>(
    `select total_lances, lider_id, lance_atual_centavos::text, fim_em, fim_original_em
       from lots where id = $1`,
    [loteId],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error(`lote ${loteId} não existe`);
  return {
    total: linha.total_lances,
    liderId: linha.lider_id,
    lanceAtualCentavos:
      linha.lance_atual_centavos === null ? null : Number(linha.lance_atual_centavos),
    fimEm: linha.fim_em,
    fimOriginalEm: linha.fim_original_em,
  };
}

/** Lances e lançamentos do ledger ligados ao lote (para provar que uma recusa não escreveu nada). */
export async function contagemDoLote(pool: pg.Pool, loteId: string): Promise<ContagemDoLote> {
  const { rows } = await pool.query<{ lances: string; lancamentos: string }>(
    `select (select count(*) from bids where lote_id = $1)::text as lances,
            (select count(*) from ledger_entries where lote_id = $1)::text as lancamentos`,
    [loteId],
  );
  return { lances: Number(rows[0]?.lances), lancamentos: Number(rows[0]?.lancamentos) };
}

/** Nome e e-mail dos usuários, para a varredura de privacidade das respostas públicas. */
export async function dadosDosUsuarios(
  pool: pg.Pool,
  ids: readonly string[],
): Promise<{ id: string; nome: string; email: string }[]> {
  const { rows } = await pool.query<{ id: string; nome: string; email: string }>(
    'select id, nome, email from users where id = any($1::uuid[])',
    [ids],
  );
  return rows;
}
