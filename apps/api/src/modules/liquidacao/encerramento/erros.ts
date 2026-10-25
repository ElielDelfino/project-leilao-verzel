// Recusas de domínio da liquidação (specs/010 §Atomicidade). Todas exigem rollback da transação
// inteira; a mensagem não leva id de usuário, valor nem dado do selo, só o código.
export type CodigoDoErroDeLiquidacao =
  /** Selo devolvido por `selar` diverge do lote travado (líder, valor, total): integridade. */
  | 'SELO_INCOERENTE'
  /** Já existe recibo para o lote (unique `receipts_lote_id_unique`). */
  | 'RECIBO_JA_EMITIDO'
  /** Três colisões seguidas no unique do código público (praticamente impossível). */
  | 'CODIGO_PUBLICO_ESGOTADO';

export class ErroDeLiquidacao extends Error {
  override readonly name = 'ErroDeLiquidacao';

  constructor(
    readonly codigo: CodigoDoErroDeLiquidacao,
    readonly loteId: string,
  ) {
    super(`liquidação recusada: ${codigo}`);
  }
}
