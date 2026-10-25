// Emissão do comprovante na transação do encerramento (specs/010 §Dados, tarefa 105). O recibo é
// montado só com o retorno de `lances.selar` e com o vencedor e o valor do lote travado: a
// coerência com `lot_seals` não tem FK entre módulos e depende deste código.
import { converterErroDoBanco, ErroDoBanco, type Transacao } from '../../../db/banco.js';
import { receipts } from '../schema.js';
import { gerarCodigoPublico } from './codigo-publico.js';
import { ErroDeLiquidacao } from './erros.js';

export const TENTATIVAS_DO_CODIGO = 3;
const VIOLACAO_DE_UNICIDADE = '23505';
const UNICO_DO_CODIGO = 'receipts_codigo_publico_unique';
const UNICO_DO_LOTE = 'receipts_lote_id_unique';

/** Dados do recibo: os do selo em hex/base64url/ISO, como `SeloGravado` os devolve. */
export interface DadosDoRecibo {
  readonly loteId: string;
  readonly vencedorId: string;
  readonly vencedorPseudonimo: string;
  readonly valorCentavos: number;
  readonly hashFinalHex: string;
  readonly assinaturaSeloBase64url: string;
  readonly keyId: string;
  readonly seladoEm: string;
}

/** Restrição unique violada, se o erro for um 23505; do contrário, undefined. */
function unicoViolado(erro: unknown): string | undefined {
  const convertido = converterErroDoBanco(erro);
  if (!(convertido instanceof ErroDoBanco) || convertido.codigo !== VIOLACAO_DE_UNICIDADE) {
    return undefined;
  }
  return convertido.restricao;
}

/**
 * Grava o recibo e devolve o código público. Cada tentativa roda num SAVEPOINT (transação
 * aninhada), para que a colisão do código não aborte a transação do encerramento; até
 * `TENTATIVAS_DO_CODIGO` códigos. Recibo já emitido para o lote → RECIBO_JA_EMITIDO.
 */
export async function emitirRecibo(
  tx: Transacao,
  dados: DadosDoRecibo,
  gerar: () => string = gerarCodigoPublico,
): Promise<string> {
  const linha = {
    loteId: dados.loteId,
    vencedorId: dados.vencedorId,
    vencedorPseudonimo: dados.vencedorPseudonimo,
    valorCentavos: dados.valorCentavos,
    hashFinal: Buffer.from(dados.hashFinalHex, 'hex'),
    assinaturaSelo: Buffer.from(dados.assinaturaSeloBase64url, 'base64url'),
    keyId: dados.keyId,
    seladoEm: new Date(dados.seladoEm),
  };
  for (let tentativa = 0; tentativa < TENTATIVAS_DO_CODIGO; tentativa += 1) {
    const codigoPublico = gerar();
    try {
      await tx.transaction(async (savepoint) => {
        await savepoint.insert(receipts).values({ ...linha, codigoPublico });
      });
      return codigoPublico;
    } catch (erro: unknown) {
      const restricao = unicoViolado(erro);
      if (restricao === UNICO_DO_LOTE)
        throw new ErroDeLiquidacao('RECIBO_JA_EMITIDO', dados.loteId);
      if (restricao !== UNICO_DO_CODIGO) throw erro;
    }
  }
  throw new ErroDeLiquidacao('CODIGO_PUBLICO_ESGOTADO', dados.loteId);
}
