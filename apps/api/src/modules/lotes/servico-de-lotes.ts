// Regras de escrita e do painel do leiloeiro (specs/006 §Criação e §Painel). O controller já
// passou por CSRF, autenticação, papel e validação; aqui ficam o fluxo do snapshot em duas etapas
// e as leituras do painel. `lotes` só fala com `catalogo` pela interface pública (specs/001).
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { ErroApi } from '../../common/erros/erro-api.js';
import { BANCO } from '../../config/banco.module.js';
import type { BancoVerificavel } from '../../db/banco.js';
import { ServicoDeCatalogo } from '../catalogo/index.js';
import type { FiltrosDaVitrine } from './esquemas-da-vitrine.js';
import { LOTES_POR_PAGINA, type NovoLoteValidado, tituloDoLote } from './esquemas.js';
import {
  contarLotesDaVitrine,
  contarLotesDoLeiloeiro,
  inserirLote,
  lerLoteDoDetalhe,
  lerResumoDoLeiloeiro,
  type LinhaDoDetalhe,
  type LinhaDoLote,
  listarLotesDaVitrine,
  listarLotesDoLeiloeiro,
} from './repositorio.js';

type Lote = SchemasApi['Lote'];
type LoteDetalhe = SchemasApi['LoteDetalhe'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loteNaoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Lote não encontrado.',
  });
}

/**
 * Só com as colunas de `lots` (specs/006 §Posição): `ganhando` com o lote ao vivo (status
 * derivado) e o usuário na liderança; `venceu` com o lote encerrado e o usuário vencedor; null
 * nos demais casos e para anônimos.
 */
export function posicaoDoUsuario(
  linha: Pick<LinhaDoDetalhe, 'status' | 'liderId' | 'vencedorId'>,
  usuarioId: string | undefined,
): LoteDetalhe['suaPosicao'] {
  if (usuarioId === undefined) return null;
  if (linha.status === 'ao_vivo' && linha.liderId === usuarioId) return 'ganhando';
  if (linha.status === 'encerrado' && linha.vencedorId === usuarioId) return 'venceu';
  return null;
}
type ResumoDoPainel = SchemasApi['ResumoDoPainel'];
type MetaPaginacao = SchemasApi['MetaPaginacao'];

export interface PaginaDeLotes {
  readonly dados: readonly Lote[];
  readonly meta: MetaPaginacao;
}

/** Linha de `lots` → `Lote` (openapi.yaml), sem nenhum dado de usuário. */
export function paraLote(linha: LinhaDoLote): Lote {
  return {
    id: linha.id,
    titulo: linha.titulo,
    status: linha.status,
    cartaNome: linha.cartaNome,
    raridade: linha.raridade as Lote['raridade'],
    imagemUrl: `/api/imagens/${linha.snapshotId}`,
    inicioEm: linha.inicioEm.toISOString(),
    fimEm: linha.fimEm.toISOString(),
    lanceInicialCentavos: linha.lanceInicialCentavos,
    incrementoMinimoCentavos: linha.incrementoMinimoCentavos,
    lanceAtualCentavos: linha.lanceAtualCentavos,
    precoAtualCentavos: linha.lanceAtualCentavos ?? linha.lanceInicialCentavos,
    totalLances: linha.totalLances,
    valorArremateCentavos: linha.valorArremateCentavos,
    criadoEm: linha.criadoEm.toISOString(),
  };
}

@Injectable()
export class ServicoDeLotes {
  constructor(
    @Inject(BANCO) private readonly banco: BancoVerificavel,
    @Inject(ServicoDeCatalogo) private readonly catalogo: ServicoDeCatalogo,
  ) {}

  /**
   * Duas etapas (specs/005 §Snapshot): o preparo (rede) fica fora da transação e falha com 503 ou
   * 422 sem criar nada; depois snapshot e lote entram juntos numa transação, tudo ou nada.
   */
  async criar(leiloeiroId: string, dados: NovoLoteValidado): Promise<Lote> {
    const preparado = await this.catalogo.prepararSnapshot(dados.scryfallId);
    const linha = await this.banco.transaction(async (tx) => {
      const snapshotId = await this.catalogo.gravarSnapshot(tx, preparado);
      return inserirLote(tx, {
        leiloeiroId,
        snapshotId,
        cartaNome: preparado.nome,
        raridade: preparado.raridade,
        titulo: tituloDoLote(dados.titulo, preparado.nome),
        descricao: dados.descricao,
        lanceInicialCentavos: dados.lanceInicialCentavos,
        incrementoMinimoCentavos: dados.incrementoMinimoCentavos,
        inicioEm: dados.inicioEm,
        fimEm: dados.fimEm,
      });
    });
    return paraLote(linha);
  }

  /** Página além da última → dados [] com o total real; `pagina` já validada (1 a 500). */
  async listarDoLeiloeiro(leiloeiroId: string, pagina: number): Promise<PaginaDeLotes> {
    return this.banco.consultar(async (db) => {
      // Em sequência: uma conexão do pool por requisição.
      const total = await contarLotesDoLeiloeiro(db, leiloeiroId);
      const linhas = await listarLotesDoLeiloeiro(db, leiloeiroId, {
        limite: LOTES_POR_PAGINA,
        deslocamento: (pagina - 1) * LOTES_POR_PAGINA,
      });
      return {
        dados: linhas.map(paraLote),
        meta: { total, pagina, limite: LOTES_POR_PAGINA },
      };
    });
  }

  async resumo(leiloeiroId: string): Promise<ResumoDoPainel> {
    return this.banco.consultar((db) => lerResumoDoLeiloeiro(db, leiloeiroId));
  }

  /** Vitrine pública (specs/006 §Vitrine): só banco, nunca a Scryfall. */
  async listarDaVitrine(filtros: FiltrosDaVitrine): Promise<PaginaDeLotes> {
    return this.banco.consultar(async (db) => {
      const total = await contarLotesDaVitrine(db, filtros);
      const linhas = await listarLotesDaVitrine(db, filtros, {
        limite: LOTES_POR_PAGINA,
        deslocamento: (filtros.pagina - 1) * LOTES_POR_PAGINA,
      });
      return {
        dados: linhas.map(paraLote),
        meta: { total, pagina: filtros.pagina, limite: LOTES_POR_PAGINA },
      };
    });
  }

  /**
   * Detalhe (specs/006 §Detalhe): qualquer status, inclusive cancelado; id inexistente ou que não
   * é UUID → 404. A carta vem do snapshot gravado (catalogo.obterSnapshot), nunca da Scryfall.
   */
  async detalhar(id: string, usuarioId: string | undefined): Promise<LoteDetalhe> {
    if (!UUID.test(id)) throw loteNaoEncontrado();
    const linha = await this.banco.consultar((db) => lerLoteDoDetalhe(db, id));
    if (linha === undefined) throw loteNaoEncontrado();
    const carta = await this.catalogo.obterSnapshot(linha.snapshotId);
    // A FK snapshot_id garante o snapshot; sem ele o dado está inconsistente (500 genérico).
    if (carta === null) throw new Error(`snapshot do lote ${linha.id} não encontrado`);
    return {
      ...paraLote(linha),
      descricao: linha.descricao,
      fimOriginalEm: linha.fimOriginalEm.toISOString(),
      carta: { ...carta, raridade: carta.raridade as LoteDetalhe['raridade'] },
      suaPosicao: posicaoDoUsuario(linha, usuarioId),
    };
  }
}
