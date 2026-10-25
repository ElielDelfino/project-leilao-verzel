// Interface pública da carteira para lance, liquidação e cancelamento (specs/004 §Comportamento,
// tarefas 074 e 103): comprometer, liberar, estornar, debitarArremate e creditarArremate na
// transação de quem chama, com a linha de wallet_balances travada (FOR UPDATE).
// Ordem dos locks (D12): o lote primeiro (quem chama já o travou), depois as carteiras em ordem
// crescente de user_id. Quem mexe em mais de uma carteira na mesma transação (lance que supera
// outro licitante, liquidação: vencedor e leiloeiro) chama travarCarteiras com todas antes de
// movimentar. O depósito trava uma carteira só e não trava lote.
// Todo ErroDeCarteira exige rollback da tx de quem chama: nunca capturar e seguir para o commit.
// Em LANCE_JA_PROCESSADO (tarefa 093) e LIQUIDACAO_JA_PROCESSADA (tarefa 103) a tx já está
// abortada no Postgres pela violação de um índice único: qualquer comando seguinte nela falha
// até o rollback.
import { converterErroDoBanco, ErroDoBanco, type Transacao } from '../../db/banco.js';
import {
  comDisponivel,
  efeitoDoLancamento,
  type SaldoComDisponivel,
  type SaldoEmCentavos,
  type TipoDeLancamento,
} from './efeito.js';
import { atualizarSaldo, inserirLancamento, travarSaldo } from './repositorio.js';

/** Lote e lance que causam o lançamento; gravados em ledger_entries para a auditoria. */
export interface ReferenciaDoLance {
  readonly loteId: string;
  readonly lanceId: string;
}

export type CodigoDoErroDeCarteira =
  | 'SALDO_INSUFICIENTE'
  | 'COMPROMETIDO_INSUFICIENTE'
  | 'LANCE_JA_PROCESSADO'
  | 'LIQUIDACAO_JA_PROCESSADA';

/** Códigos de lançamento repetido: sem valor nem saldo. */
type CodigoDeRepeticao = 'LANCE_JA_PROCESSADO' | 'LIQUIDACAO_JA_PROCESSADA';

/** Códigos que levam o valor pedido e o saldo que o recusou. */
type CodigoComDetalhes = Exclude<CodigoDoErroDeCarteira, CodigoDeRepeticao>;

export interface DetalhesDoErroDeCarteira {
  readonly valor: number;
  readonly disponivel?: number;
  readonly comprometido?: number;
}

/**
 * Recusa de domínio (não HTTP): quem chama decide a resposta. No lance, a recusa
 * SALDO_INSUFICIENTE (specs/007) vem só de comprometer, sob o lock da carteira; a API a traduz
 * em 422 com detalhes.disponivelCentavos. LANCE_JA_PROCESSADO (comprometer ou liberar repetidos
 * para o mesmo lanceId) e LIQUIDACAO_JA_PROCESSADA (estorno, débito ou crédito repetidos para o
 * mesmo loteId) não levam valor nem saldo. O erro exige rollback da tx de quem chama.
 */
export class ErroDeCarteira extends Error {
  readonly codigo: CodigoDoErroDeCarteira;
  /** undefined só nos códigos de repetição. */
  readonly valor: number | undefined;
  readonly disponivel: number | undefined;
  readonly comprometido: number | undefined;

  constructor(codigo: CodigoDeRepeticao);
  constructor(codigo: CodigoComDetalhes, detalhes: DetalhesDoErroDeCarteira);
  constructor(codigo: CodigoDoErroDeCarteira, detalhes?: DetalhesDoErroDeCarteira) {
    super(`operação na carteira recusada: ${codigo}`);
    this.name = 'ErroDeCarteira';
    this.codigo = codigo;
    this.valor = detalhes?.valor;
    this.disponivel = detalhes?.disponivel;
    this.comprometido = detalhes?.comprometido;
  }
}

/**
 * Índices únicos parciais de ledger_entries e o código de cada um: (lance_id, tipo) para
 * compromisso e liberação (migration 0004, tarefa 092); (lote_id, tipo) para estorno, débito e
 * crédito do arremate (tarefa 102, D4).
 */
const CODIGO_POR_INDICE: ReadonlyMap<string, CodigoDeRepeticao> = new Map([
  ['ledger_entries_lance_id_tipo_unico', 'LANCE_JA_PROCESSADO'],
  ['ledger_entries_lote_id_tipo_unico', 'LIQUIDACAO_JA_PROCESSADA'],
]);
const VIOLACAO_DE_UNICIDADE = '23505';

/**
 * Violação de um dos índices vira o ErroDeCarteira do índice, sem `cause`: o erro do driver
 * traz SQL, parâmetros e a linha (`detail`). Qualquer outro erro volta como veio.
 */
function traduzirLancamentoRepetido(erro: unknown): unknown {
  const convertido = converterErroDoBanco(erro);
  if (!(convertido instanceof ErroDoBanco) || convertido.codigo !== VIOLACAO_DE_UNICIDADE) {
    return erro;
  }
  const restricao = convertido.restricao;
  const codigo = restricao === undefined ? undefined : CODIGO_POR_INDICE.get(restricao);
  return codigo === undefined ? erro : new ErroDeCarteira(codigo);
}

/**
 * user_id em ordem crescente, sem repetidos, em minúsculas: para uuid canônico, a ordem de
 * string em minúsculas é a mesma do tipo uuid no Postgres. Não altera a lista recebida.
 * Não aceita undefined: quem chama monta a lista só com ids existentes (no primeiro lance do
 * lote não há líder anterior).
 */
export function ordemDeTrava(userIds: readonly string[]): readonly string[] {
  const unicos = new Set(userIds.map((id) => id.toLowerCase()));
  return [...unicos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Trava as carteiras em ordem crescente de user_id (D12) e devolve o saldo de cada uma.
 * userIds não aceita undefined: monte a lista só com ids existentes (sem líder anterior, omita-o).
 */
export async function travarCarteiras(
  tx: Transacao,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, SaldoEmCentavos>> {
  const saldos = new Map<string, SaldoEmCentavos>();
  // Em sequência, de propósito: a ordem dos FOR UPDATE é o que evita o deadlock.
  for (const userId of ordemDeTrava(userIds)) {
    saldos.set(userId, await travarSaldo(tx, userId));
  }
  return saldos;
}

/** Trava, confere, grava o lançamento e atualiza a projeção, tudo na `tx` de quem chama. */
async function movimentar(
  tx: Transacao,
  userId: string,
  tipo: Exclude<TipoDeLancamento, 'deposito'>,
  valorCentavos: number,
  referencia: ReferenciaDoLance,
  conferir: (saldo: SaldoEmCentavos) => void,
): Promise<SaldoComDisponivel> {
  // Valida o valor antes de tocar o banco (RangeError se não for inteiro positivo seguro).
  const efeito = efeitoDoLancamento(tipo, valorCentavos);
  conferir(await travarSaldo(tx, userId));
  try {
    await inserirLancamento(tx, {
      userId,
      tipo,
      valorCentavos,
      loteId: referencia.loteId,
      lanceId: referencia.lanceId,
    });
  } catch (erro: unknown) {
    // Relança sempre, traduzido ou não: o rollback é de quem chama (a 23505 já abortou a tx).
    throw traduzirLancamentoRepetido(erro);
  }
  return comDisponivel(await atualizarSaldo(tx, userId, efeito));
}

/**
 * Compromisso (licitante passa a liderar o lote): comprometido += valor. Recusa com
 * ErroDeCarteira SALDO_INSUFICIENTE se o disponível não cobre o valor. Devolve o saldo novo.
 */
export function comprometer(
  tx: Transacao,
  userId: string,
  valorCentavos: number,
  referencia: ReferenciaDoLance,
): Promise<SaldoComDisponivel> {
  return movimentar(tx, userId, 'compromisso', valorCentavos, referencia, (saldo) => {
    const disponivel = saldo.total - saldo.comprometido;
    if (disponivel < valorCentavos) {
      throw new ErroDeCarteira('SALDO_INSUFICIENTE', { valor: valorCentavos, disponivel });
    }
  });
}

/**
 * Liberação (licitante superado): comprometido −= valor. Recusa com ErroDeCarteira
 * COMPROMETIDO_INSUFICIENTE se o valor passa do comprometido (bug de quem chama; o CHECK de
 * wallet_balances seria a última defesa). Devolve o saldo novo.
 */
export function liberar(
  tx: Transacao,
  userId: string,
  valorCentavos: number,
  referencia: ReferenciaDoLance,
): Promise<SaldoComDisponivel> {
  return movimentar(tx, userId, 'liberacao', valorCentavos, referencia, (saldo) =>
    exigirComprometido(saldo, valorCentavos),
  );
}

/**
 * Estorno (lote cancelado com líder, specs/006): comprometido −= valor do líder. Recusa com
 * COMPROMETIDO_INSUFICIENTE se o valor passa do comprometido. `referencia` é o lote e o último
 * lance (D4). Devolve o saldo novo.
 */
export function estornar(
  tx: Transacao,
  userId: string,
  valorCentavos: number,
  referencia: ReferenciaDoLance,
): Promise<SaldoComDisponivel> {
  return movimentar(tx, userId, 'estorno', valorCentavos, referencia, (saldo) =>
    exigirComprometido(saldo, valorCentavos),
  );
}

/**
 * Débito do arremate (liquidação, specs/010): total −= valor e comprometido −= valor do
 * vencedor. Recusa com COMPROMETIDO_INSUFICIENTE se o valor passa do comprometido. Devolve o
 * saldo novo.
 */
export function debitarArremate(
  tx: Transacao,
  userId: string,
  valorCentavos: number,
  referencia: ReferenciaDoLance,
): Promise<SaldoComDisponivel> {
  return movimentar(tx, userId, 'debito_arremate', valorCentavos, referencia, (saldo) =>
    exigirComprometido(saldo, valorCentavos),
  );
}

/**
 * Crédito do arremate (liquidação, specs/010): total += valor do leiloeiro. Sem conferência de
 * saldo; a linha de wallet_balances nasce aqui se o leiloeiro ainda não tinha (specs/004).
 * Devolve o saldo novo.
 */
export function creditarArremate(
  tx: Transacao,
  leiloeiroId: string,
  valorCentavos: number,
  referencia: ReferenciaDoLance,
): Promise<SaldoComDisponivel> {
  return movimentar(tx, leiloeiroId, 'credito_arremate', valorCentavos, referencia, () => {
    // Crédito não depende do saldo anterior.
  });
}

/** COMPROMETIDO_INSUFICIENTE se o valor passa do comprometido (bug de quem chama). */
function exigirComprometido(saldo: SaldoEmCentavos, valorCentavos: number): void {
  if (saldo.comprometido < valorCentavos) {
    throw new ErroDeCarteira('COMPROMETIDO_INSUFICIENTE', {
      valor: valorCentavos,
      comprometido: saldo.comprometido,
    });
  }
}
