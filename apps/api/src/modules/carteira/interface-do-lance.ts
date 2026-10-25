// Interface pública da carteira para o lance (specs/004 §Comportamento, tarefa 074): comprometer
// e liberar na transação de quem chama, com a linha de wallet_balances travada (FOR UPDATE).
// Ordem dos locks (D12): o lote primeiro (quem chama já o travou), depois as carteiras em ordem
// crescente de user_id. Quem mexe em mais de uma carteira na mesma transação (lance que supera
// outro licitante, liquidação) chama travarCarteiras com todas antes de comprometer ou liberar.
// Todo ErroDeCarteira exige rollback da tx de quem chama: nunca capturar e seguir para o commit.
// Em LANCE_JA_PROCESSADO (tarefa 093) a tx já está abortada no Postgres pela violação do índice
// único (lance_id, tipo): qualquer comando seguinte nela falha até o rollback.
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
  'SALDO_INSUFICIENTE' | 'COMPROMETIDO_INSUFICIENTE' | 'LANCE_JA_PROCESSADO';

/** Códigos que levam o valor pedido e o saldo que o recusou. */
type CodigoComDetalhes = Exclude<CodigoDoErroDeCarteira, 'LANCE_JA_PROCESSADO'>;

export interface DetalhesDoErroDeCarteira {
  readonly valor: number;
  readonly disponivel?: number;
  readonly comprometido?: number;
}

/**
 * Recusa de domínio (não HTTP): quem chama decide a resposta. No lance, a recusa
 * SALDO_INSUFICIENTE (specs/007) vem só de comprometer, sob o lock da carteira; a API a traduz
 * em 422 com detalhes.disponivelCentavos. LANCE_JA_PROCESSADO (comprometer ou liberar repetidos
 * para o mesmo lanceId) não leva valor nem saldo. O erro exige rollback da tx de quem chama.
 */
export class ErroDeCarteira extends Error {
  readonly codigo: CodigoDoErroDeCarteira;
  /** undefined só em LANCE_JA_PROCESSADO. */
  readonly valor: number | undefined;
  readonly disponivel: number | undefined;
  readonly comprometido: number | undefined;

  constructor(codigo: 'LANCE_JA_PROCESSADO');
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

/** Índice único parcial de ledger_entries (migration 0004, tarefa 092). */
const INDICE_DO_LANCE = 'ledger_entries_lance_id_tipo_unico';
const VIOLACAO_DE_UNICIDADE = '23505';

/**
 * Violação do índice (lance_id, tipo) vira LANCE_JA_PROCESSADO, sem `cause`: o erro do driver
 * traz SQL, parâmetros e a linha (`detail`). Qualquer outro erro volta como veio.
 */
function traduzirLancamentoRepetido(erro: unknown): unknown {
  const convertido = converterErroDoBanco(erro);
  const repetido =
    convertido instanceof ErroDoBanco &&
    convertido.codigo === VIOLACAO_DE_UNICIDADE &&
    convertido.restricao === INDICE_DO_LANCE;
  return repetido ? new ErroDeCarteira('LANCE_JA_PROCESSADO') : erro;
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
  tipo: Extract<TipoDeLancamento, 'compromisso' | 'liberacao'>,
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
  return movimentar(tx, userId, 'liberacao', valorCentavos, referencia, (saldo) => {
    if (saldo.comprometido < valorCentavos) {
      throw new ErroDeCarteira('COMPROMETIDO_INSUFICIENTE', {
        valor: valorCentavos,
        comprometido: saldo.comprometido,
      });
    }
  });
}
