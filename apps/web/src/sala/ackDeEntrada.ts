import type { CodigoDeErroDaSala, EstadoDoServidor } from './tiposDoServidor';

/** Resultado já validado do ack de `entrar_lote`; qualquer resposta malformada vira `INDISPONIVEL`. */
export type ResultadoDaEntrada =
  { sucesso: true; estado: EstadoDoServidor } | { sucesso: false; codigo: CodigoDeErroDaSala };

const CODIGOS_CONHECIDOS: readonly string[] = [
  'DADOS_INVALIDOS',
  'NAO_ENCONTRADO',
  'SALA_CHEIA',
  'INDISPONIVEL',
] satisfies CodigoDeErroDaSala[];

const FALHA_GENERICA: ResultadoDaEntrada = { sucesso: false, codigo: 'INDISPONIVEL' };

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

function ehCodigoDeErro(valor: unknown): valor is CodigoDeErroDaSala {
  return typeof valor === 'string' && CODIGOS_CONHECIDOS.includes(valor);
}

/** Só confere o que `criarEstadoDaSala` lê; o resto do formato é contrato do servidor. */
function ehEstadoUtilizavel(valor: unknown): valor is EstadoDoServidor {
  return (
    ehObjeto(valor) &&
    ehObjeto(valor['lote']) &&
    Array.isArray(valor['ultimosLances']) &&
    typeof valor['agoraServidor'] === 'string'
  );
}

/** Valida em tempo de execução o ack recebido do servidor (dado externo, nunca confiável). */
export function interpretarAck(ack: unknown): ResultadoDaEntrada {
  if (!ehObjeto(ack) || typeof ack['sucesso'] !== 'boolean') return FALHA_GENERICA;
  if (ack['sucesso']) {
    return ehEstadoUtilizavel(ack['estado'])
      ? { sucesso: true, estado: ack['estado'] }
      : FALHA_GENERICA;
  }
  const erro = ack['erro'];
  if (ehObjeto(erro) && ehCodigoDeErro(erro['codigo'])) {
    return { sucesso: false, codigo: erro['codigo'] };
  }
  return FALHA_GENERICA;
}
