// Comprovante público e "Meus arremates" (tarefa 109; specs/011). A carta vem do resumo do lote
// (`lotes.obterResumos`, em lote) e a imagem é sempre `/api/imagens/{snapshotId}`: nada aqui chama
// a Scryfall. Nenhuma resposta leva nome, e-mail nem id de usuário.
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { ErroApi } from '../../../common/erros/erro-api.js';
import { LimiteDeTentativas } from '../../../common/limite/limite-de-tentativas.js';
import { BANCO } from '../../../config/banco.module.js';
import type { Banco } from '../../../db/banco.js';
import { obterResumos, type ResumoDoLote } from '../../lotes/index.js';
import { FORMATO_DO_CODIGO_PUBLICO } from '../schema.js';
import { consumirLimiteDoComprovante } from './limite-do-comprovante.js';
import { buscarPorCodigo, contarDoVencedor, listarDoVencedor } from './repositorio.js';

type Comprovante = SchemasApi['Comprovante'];
type Arremate = SchemasApi['Arremate'];
type MetaPaginacao = SchemasApi['MetaPaginacao'];

export const ARREMATES_POR_PAGINA = 24;
const FORMATO_DO_CODIGO = new RegExp(FORMATO_DO_CODIGO_PUBLICO);

export interface PaginaDeArremates {
  readonly dados: readonly Arremate[];
  readonly meta: MetaPaginacao;
}

function naoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Comprovante não encontrado.',
  });
}

function paraCarta(resumo: ResumoDoLote): SchemasApi['CartaDoComprovante'] {
  return { nome: resumo.cartaNome, imagemUrl: `/api/imagens/${resumo.snapshotId}` };
}

@Injectable()
export class ServicoDeComprovantes {
  readonly #logger = new Logger('Comprovantes');

  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(LimiteDeTentativas) private readonly limite: LimiteDeTentativas,
  ) {}

  /**
   * Código malformado e inexistente dão o mesmo 404; o malformado não consome o contador
   * (specs/011), o bem formado consome mesmo que o recibo não exista.
   */
  async porCodigo(codigo: string): Promise<Comprovante> {
    if (!FORMATO_DO_CODIGO.test(codigo)) throw naoEncontrado();
    await consumirLimiteDoComprovante(this.limite, (m) => this.#logger.warn(m));
    return this.banco.consultar(async (db) => {
      const recibo = await buscarPorCodigo(db, codigo);
      if (recibo === undefined) throw naoEncontrado();
      const [lote] = await obterResumos(db, [recibo.loteId]);
      if (lote === undefined) throw new Error(`lote do recibo ${recibo.loteId} não encontrado`);
      return {
        codigo: recibo.codigoPublico,
        vencedorPseudonimo: recibo.vencedorPseudonimo,
        valorCentavos: recibo.valorCentavos,
        carta: paraCarta(lote),
        hashFinal: recibo.hashFinal.toString('hex'),
        assinaturaSelo: recibo.assinaturaSelo.toString('base64url'),
        keyId: recibo.keyId,
        seladoEm: recibo.seladoEm.toISOString(),
        emitidoEm: recibo.emitidoEm.toISOString(),
        auditoriaUrl: `/auditoria/${recibo.loteId}`,
      };
    });
  }

  /** Só os recibos do usuário da sessão; um `obterResumos` para a página inteira (sem N+1). */
  async doUsuario(usuarioId: string, pagina: number): Promise<PaginaDeArremates> {
    return this.banco.consultar(async (db) => {
      const total = await contarDoVencedor(db, usuarioId);
      const recibos = await listarDoVencedor(db, usuarioId, {
        limite: ARREMATES_POR_PAGINA,
        deslocamento: (pagina - 1) * ARREMATES_POR_PAGINA,
      });
      const resumos = new Map(
        (
          await obterResumos(
            db,
            recibos.map((r) => r.loteId),
          )
        ).map((r) => [r.id, r]),
      );
      const dados = recibos.map((recibo): Arremate => {
        const lote = resumos.get(recibo.loteId);
        if (lote === undefined) throw new Error(`lote do recibo ${recibo.loteId} não encontrado`);
        return {
          codigo: recibo.codigoPublico,
          valorCentavos: recibo.valorCentavos,
          carta: paraCarta(lote),
          emitidoEm: recibo.emitidoEm.toISOString(),
          auditoriaUrl: `/auditoria/${recibo.loteId}`,
        };
      });
      return { dados, meta: { total, pagina, limite: ARREMATES_POR_PAGINA } };
    });
  }
}
