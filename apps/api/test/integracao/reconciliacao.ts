// Reconciliação da carteira (specs/004 RNF-02 e §Critérios de aceite): para todo usuário, a
// projeção `wallet_balances` tem de ser igual à soma do ledger, com o efeito de cada tipo de
// lançamento da tabela de specs/004 §Comportamento. Usada pelos testes de integração e pelo
// globalTeardown do e2e.

export interface ConsultaSql {
  query(texto: string): Promise<{ rows: readonly unknown[] }>;
}

export interface Divergencia {
  readonly userId: string;
  readonly ledgerTotalCentavos: number;
  readonly ledgerComprometidoCentavos: number;
  readonly projecaoTotalCentavos: number;
  readonly projecaoComprometidoCentavos: number;
}

// Efeitos (specs/004): deposito +total; compromisso +comprometido; liberacao e estorno
// −comprometido; debito_arremate −total e −comprometido; credito_arremate +total.
const SQL_DE_DIVERGENCIAS = `
  with soma as (
    select user_id,
      sum(case tipo when 'deposito' then valor_centavos when 'credito_arremate' then valor_centavos
        when 'debito_arremate' then -valor_centavos else 0 end) as total,
      sum(case tipo when 'compromisso' then valor_centavos
        when 'liberacao' then -valor_centavos when 'estorno' then -valor_centavos
        when 'debito_arremate' then -valor_centavos else 0 end) as comprometido
    from ledger_entries group by user_id
  )
  select coalesce(s.user_id, w.user_id)::text as user_id,
    coalesce(s.total, 0)::text as ledger_total,
    coalesce(s.comprometido, 0)::text as ledger_comprometido,
    coalesce(w.total_centavos, 0)::text as projecao_total,
    coalesce(w.comprometido_centavos, 0)::text as projecao_comprometido
  from soma s full join wallet_balances w on w.user_id = s.user_id
  where coalesce(s.total, 0) <> coalesce(w.total_centavos, 0)
     or coalesce(s.comprometido, 0) <> coalesce(w.comprometido_centavos, 0)
  order by 1`;

interface Linha {
  user_id: string;
  ledger_total: string;
  ledger_comprometido: string;
  projecao_total: string;
  projecao_comprometido: string;
}

/** Usuários cuja projeção difere da soma do ledger (lista vazia = reconciliado). */
export async function divergenciasDaCarteira(
  conexao: ConsultaSql,
): Promise<readonly Divergencia[]> {
  const { rows } = await conexao.query(SQL_DE_DIVERGENCIAS);
  return (rows as readonly Linha[]).map((l) => ({
    userId: l.user_id,
    ledgerTotalCentavos: Number(l.ledger_total),
    ledgerComprometidoCentavos: Number(l.ledger_comprometido),
    projecaoTotalCentavos: Number(l.projecao_total),
    projecaoComprometidoCentavos: Number(l.projecao_comprometido),
  }));
}

/** Mensagem só com ids de usuário e valores em centavos: nunca e-mail nem nome. */
export function descreverDivergencias(divergencias: readonly Divergencia[]): string {
  return divergencias
    .map(
      (d) =>
        `usuário ${d.userId}: ledger total=${d.ledgerTotalCentavos} comprometido=` +
        `${d.ledgerComprometidoCentavos}, projeção total=${d.projecaoTotalCentavos} ` +
        `comprometido=${d.projecaoComprometidoCentavos}`,
    )
    .join('\n');
}

/** Lança com os ids divergentes; não devolve nada quando a carteira está reconciliada. */
export async function exigirCarteiraReconciliada(conexao: ConsultaSql): Promise<void> {
  const divergencias = await divergenciasDaCarteira(conexao);
  if (divergencias.length > 0) {
    throw new Error(
      `reconciliação da carteira: ${divergencias.length} usuário(s) com projeção ≠ Σ ledger\n` +
        descreverDivergencias(divergencias),
    );
  }
}
