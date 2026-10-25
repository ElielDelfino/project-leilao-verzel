// Regras de escrita e do painel do leiloeiro (specs/006 §Criação e §Painel). O controller já
// passou por CSRF, autenticação, papel e validação; aqui ficam o fluxo do snapshot em duas etapas
// e as leituras do painel. `lotes` só fala com `catalogo` pela interface pública (specs/001).
import { Inject, Injectable } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { BANCO } from '../../config/banco.module.js';
import type { BancoVerificavel } from '../../db/banco.js';
import { ServicoDeCatalogo } from '../catalogo/index.js';
import { LOTES_POR_PAGINA, type NovoLoteValidado, tituloDoLote } from './esquemas.js';
import {
  contarLotesDoLeiloeiro,
  inserirLote,
  lerResumoDoLeiloeiro,
  type LinhaDoLote,
  listarLotesDoLeiloeiro,
} from './repositorio.js';

type Lote = SchemasApi['Lote'];
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
}
