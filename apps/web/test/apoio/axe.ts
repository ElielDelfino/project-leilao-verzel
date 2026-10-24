import axe from 'axe-core';

const IMPACTOS_SERIOS = new Set(['serious', 'critical']);

export interface ViolacaoResumida {
  id: string;
  impacto: string | null | undefined;
  alvos: string[];
}

/**
 * Roda o axe-core no documento e devolve só as violações sérias/críticas (critério da tarefa 005).
 * No jsdom o axe não mede contraste de cor; isso fica em test/estilos/contraste.test.ts e no e2e.
 */
export async function violacoesSerias(
  contexto: axe.ElementContext = document,
): Promise<ViolacaoResumida[]> {
  const resultado = await axe.run(contexto, { resultTypes: ['violations'] });
  return resultado.violations
    .filter((violacao) => IMPACTOS_SERIOS.has(violacao.impact ?? ''))
    .map((violacao) => ({
      id: violacao.id,
      impacto: violacao.impact,
      alvos: violacao.nodes.flatMap((no) => no.target.map(String)),
    }));
}
