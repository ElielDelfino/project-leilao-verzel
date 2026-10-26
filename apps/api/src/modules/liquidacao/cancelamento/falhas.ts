// Respostas do cancelamento (specs/010 §Cancelamento, tarefa 106): recusas antes e dentro da
// transação, tradução das falhas que saem dela (já em rollback) e o `Lote` do contrato montado do
// resumo de `lotes.obterResumos`, sem nenhum dado de usuário.
import { HttpStatus } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { ErroApi } from '../../../common/erros/erro-api.js';
import { ErroDoBanco } from '../../../db/banco.js';
import { type CodigoDoErroDeLote, ErroDeLote, type ResumoDoLote } from '../../lotes/index.js';

type Lote = SchemasApi['Lote'];

/** Contenção de lock além do lock_timeout. */
const LOCK_TIMEOUT = '55P03';
/** Consulta além do statement_timeout. */
const STATEMENT_TIMEOUT = '57014';

/** Inexistente, de outro leiloeiro ou id fora do formato: o mesmo 404, sem pista do caso. */
export function loteNaoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Lote não encontrado.',
  });
}

/** `encerrado` ou `cancelado` gravado, ou `agora(tx) >= fim_em` (ADR 0032). */
export function loteEncerrado(): ErroApi {
  return new ErroApi({
    codigo: 'LOTE_ENCERRADO',
    status: HttpStatus.CONFLICT,
    mensagem: 'O lote já foi encerrado.',
  });
}

function indisponivel(): ErroApi {
  return new ErroApi({
    codigo: 'INDISPONIVEL',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    mensagem: 'Serviço temporariamente indisponível. Tente novamente.',
  });
}

/** Recusas de `cancelarLote` (o fim venceu entre o `agora(tx)` e o UPDATE, ou o status mudou). */
const RECUSAS_DO_CANCELAMENTO: ReadonlySet<CodigoDoErroDeLote> = new Set([
  'ESTADO_INVALIDO',
  'FIM_VENCIDO',
]);

/**
 * Falha que saiu da transação → resposta do contrato. 55P03 e 57014 → 503 sem `detalhes` (não
 * diz qual dependência falhou). ErroDeLote ESTADO_INVALIDO ou FIM_VENCIDO de `cancelarLote` →
 * 409 LOTE_ENCERRADO. O resto volta como veio: outro ErroDeLote, ErroDeSelo, ErroDeCarteira e
 * bugs são falhas internas (500 pelo filtro global).
 */
export function traduzirFalhaDoCancelamento(erro: unknown): unknown {
  if (erro instanceof ErroDoBanco) {
    return erro.codigo === LOCK_TIMEOUT || erro.codigo === STATEMENT_TIMEOUT
      ? indisponivel()
      : erro;
  }
  if (erro instanceof ErroDeLote && RECUSAS_DO_CANCELAMENTO.has(erro.codigo)) {
    return loteEncerrado();
  }
  return erro;
}

/** Resumo de `lotes` → `Lote` (openapi.yaml); `liderId` e `vencedorId` ficam de fora. */
export function paraLote(resumo: ResumoDoLote): Lote {
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
