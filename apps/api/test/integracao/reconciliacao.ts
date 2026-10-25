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

type Sinal = -1 | 0 | 1;

/**
 * Efeito de cada tipo sobre [total, comprometido] (specs/004): deposito +total; compromisso
 * +comprometido; liberacao e estorno −comprometido; debito_arremate −total e −comprometido;
 * credito_arremate +total. Toda a lista dos tipos que o SQL trata sai daqui.
 */
const EFEITOS_NO_SQL = {
  deposito: [1, 0],
  compromisso: [0, 1],
  liberacao: [0, -1],
  estorno: [0, -1],
  debito_arremate: [-1, -1],
  credito_arremate: [1, 0],
} as const satisfies Readonly<Record<string, readonly [Sinal, Sinal]>>;

/** Tipos de lançamento que o SQL de reconciliação trata (o enum `tipo_lancamento` tem de igualar). */
export const TIPOS_TRATADOS_PELO_SQL: readonly string[] = Object.keys(EFEITOS_NO_SQL);

function parcela(sinal: Sinal): string {
  if (sinal === 0) return '0';
  return sinal === 1 ? 'valor_centavos' : '-valor_centavos';
}

/**
 * CASE de um dos eixos. Tipo fora da tabela não soma 0 em silêncio: o `else` força um erro de
 * conversão que cita o tipo (invalid input syntax for type bigint: "tipo sem efeito no SQL: x").
 */
function casoDoEixo(eixo: 0 | 1): string {
  const ramos = Object.entries(EFEITOS_NO_SQL)
    .map(([tipo, efeito]) => `when '${tipo}' then ${parcela(efeito[eixo])}`)
    .join(' ');
  return `case tipo ${ramos} else ('tipo sem efeito no SQL: ' || tipo)::bigint end`;
}

const SQL_DE_DIVERGENCIAS = `
  with soma as (
    select user_id,
      sum(${casoDoEixo(0)}) as total,
      sum(${casoDoEixo(1)}) as comprometido
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
