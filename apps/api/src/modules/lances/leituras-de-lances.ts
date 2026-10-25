// Leituras de lances (tarefa 080; specs/007 §Interfaces e contratos e §Posição do usuário no
// lote; ADR 0031 D7 e D8): histórico público do lote, GET /api/me/lances e as funções que a sala
// ao vivo (specs/009) usa para montar o estado. Só leitura. `bids` é lido aqui; o lote, só pela
// interface pública de `lotes`. Nada devolvido leva `licitante_id`, nome nem e-mail.
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { ErroApi } from '../../common/erros/erro-api.js';
import { BANCO } from '../../config/banco.module.js';
import type { Banco } from '../../db/banco.js';
import { obterResumos, type ResumoDoLote } from '../lotes/index.js';
import { ServicoDeChaves } from './chaves.js';
import { LANCES_POR_PAGINA, LOTES_DO_USUARIO_POR_PAGINA, UUID_DO_LOTE } from './esquemas.js';
import { calcularPosicao, type LancePublico, type PosicaoDoUsuario } from './regras.js';
import {
  contarLancesDoLote,
  contarLotesDoUsuario,
  type LinhaDoHistorico,
  listarLancesDoLote,
  listarLotesDoUsuario,
  usuarioTemLanceNoLote,
} from './repositorio.js';

type Lote = SchemasApi['Lote'];
type LanceDoUsuario = SchemasApi['LanceDoUsuario'];
type MetaPaginacao = SchemasApi['MetaPaginacao'];

export interface PaginaDeLances {
  readonly dados: readonly LancePublico[];
  readonly meta: MetaPaginacao;
}

export interface PaginaDeLancesDoUsuario {
  readonly dados: readonly LanceDoUsuario[];
  readonly meta: MetaPaginacao;
}

function loteNaoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Lote não encontrado.',
  });
}

function paraLancePublico(linha: LinhaDoHistorico): LancePublico {
  return {
    seq: linha.seq,
    pseudonimo: linha.pseudonimo,
    valorCentavos: linha.valorCentavos,
    criadoEm: linha.criadoEm.toISOString(),
  };
}

/**
 * Resumo de `lotes` → `Lote` do contrato. Campo a campo, de propósito: `liderId` e `vencedorId`
 * vêm no resumo só para calcular a posição e nunca podem chegar a uma resposta.
 */
function paraLote(resumo: ResumoDoLote): Lote {
  return {
    id: resumo.id,
    titulo: resumo.titulo,
    status: resumo.status,
    cartaNome: resumo.cartaNome,
    raridade: resumo.raridade as Lote['raridade'],
    imagemUrl: `/api/imagens/${resumo.snapshotId}`,
    inicioEm: resumo.inicioEm.toISOString(),
    fimEm: resumo.fimEm.toISOString(),
    lanceInicialCentavos: resumo.lanceInicialCentavos,
    incrementoMinimoCentavos: resumo.incrementoMinimoCentavos,
    lanceAtualCentavos: resumo.lanceAtualCentavos,
    precoAtualCentavos: resumo.lanceAtualCentavos ?? resumo.lanceInicialCentavos,
    totalLances: resumo.totalLances,
    valorArremateCentavos: resumo.valorArremateCentavos,
    criadoEm: resumo.criadoEm.toISOString(),
  };
}

@Injectable()
export class LeiturasDeLances {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(ServicoDeChaves) private readonly chaves: ServicoDeChaves,
  ) {}

  /**
   * Histórico público do lote, por `seq` decrescente, 50 por página. `pagina` já validada (1 a
   * 500); além da última devolve `dados` vazio com o `total` real. Lote inexistente, ou `loteId`
   * que não é UUID, → 404 NAO_ENCONTRADO.
   */
  async historicoDoLote(loteId: string, pagina: number): Promise<PaginaDeLances> {
    if (!UUID_DO_LOTE.test(loteId)) throw loteNaoEncontrado();
    return this.banco.consultar(async (db) => {
      // Em sequência: uma conexão do pool por requisição.
      const [lote] = await obterResumos(db, [loteId]);
      if (lote === undefined) throw loteNaoEncontrado();
      const total = await contarLancesDoLote(db, lote.id);
      const linhas = await listarLancesDoLote(db, lote.id, {
        limite: LANCES_POR_PAGINA,
        deslocamento: (pagina - 1) * LANCES_POR_PAGINA,
      });
      return {
        dados: linhas.map(paraLancePublico),
        meta: { total, pagina, limite: LANCES_POR_PAGINA },
      };
    });
  }

  /**
   * Um item por lote em que o usuário deu lance (GET /api/me/lances), do lance mais recente ao
   * mais antigo, 24 por página. Os lotes vêm de `obterResumos` numa só consulta (sem N+1) e,
   * como ele não garante ordem, a ordem dos agregados é reaplicada aqui.
   */
  async lancesDoUsuario(usuarioId: string, pagina: number): Promise<PaginaDeLancesDoUsuario> {
    return this.banco.consultar(async (db) => {
      const total = await contarLotesDoUsuario(db, usuarioId);
      const agregados = await listarLotesDoUsuario(db, usuarioId, {
        limite: LOTES_DO_USUARIO_POR_PAGINA,
        deslocamento: (pagina - 1) * LOTES_DO_USUARIO_POR_PAGINA,
      });
      const resumos = new Map(
        (
          await obterResumos(
            db,
            agregados.map((a) => a.loteId),
          )
        ).map((r) => [r.id, r]),
      );
      const dados = agregados.map((agregado): LanceDoUsuario => {
        const resumo = resumos.get(agregado.loteId);
        // A FK de bids.lote_id garante o lote; sem ele o dado está inconsistente (500 genérico).
        if (resumo === undefined)
          throw new Error(`lote ${agregado.loteId} de lance não encontrado`);
        const posicao = calcularPosicao(resumo, usuarioId, true);
        // `sem_lance` só sai de lote agendado, que não aceita lance: dado inconsistente.
        if (posicao === 'sem_lance') throw new Error(`lote ${resumo.id} agendado com lance`);
        return {
          lote: paraLote(resumo),
          posicao,
          meuMaiorLanceCentavos: agregado.meuMaiorLanceCentavos,
          meuUltimoLanceEm: agregado.meuUltimoLanceEm.toISOString(),
        };
      });
      return { dados, meta: { total, pagina, limite: LOTES_DO_USUARIO_POR_PAGINA } };
    });
  }

  /**
   * Posição do usuário no lote, com as cinco linhas da tabela de specs/007. Lote inexistente ou
   * `loteId` que não é UUID → `sem_lance` (o usuário não tem lance nele).
   */
  async posicaoDoUsuario(loteId: string, usuarioId: string): Promise<PosicaoDoUsuario> {
    if (!UUID_DO_LOTE.test(loteId)) return 'sem_lance';
    return this.banco.consultar(async (db) => {
      const [lote] = await obterResumos(db, [loteId]);
      if (lote === undefined) return 'sem_lance';
      const temLance = await usuarioTemLanceNoLote(db, lote.id, usuarioId);
      return calcularPosicao(lote, usuarioId, temLance);
    });
  }

  /**
   * Os `n` lances mais recentes do lote, por `seq` decrescente, nos mesmos campos do histórico
   * público (`ultimosLances` do estado da sala, specs/009). `n` é inteiro de 1 a 50, senão
   * `RangeError`. `loteId` que não é UUID ou lote sem lance → lista vazia.
   */
  async ultimosLances(loteId: string, n: number): Promise<LancePublico[]> {
    if (!Number.isInteger(n) || n < 1 || n > LANCES_POR_PAGINA) {
      throw new RangeError(`n deve ser inteiro de 1 a ${String(LANCES_POR_PAGINA)}`);
    }
    if (!UUID_DO_LOTE.test(loteId)) return [];
    const linhas = await this.banco.consultar((db) =>
      listarLancesDoLote(db, loteId, { limite: n, deslocamento: 0 }),
    );
    return linhas.map(paraLancePublico);
  }

  /**
   * Pseudônimo do usuário no lote (specs/008 §Técnica): HMAC puro, igual ao gravado nos lances e
   * devolvido mesmo sem lance (ADR 0031 D8). Não consulta o banco nem confere se o lote existe.
   * O HMAC é do texto do id, gravado em minúsculas: `loteId` é normalizado para minúsculas.
   */
  seuPseudonimo(loteId: string, usuarioId: string): string {
    return this.chaves.pseudonimo(loteId.toLowerCase(), usuarioId);
  }
}
