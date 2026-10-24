export type LinhaDeLog = Record<string, unknown>;

export interface CapturaDeLogs {
  /** Destino compatível com o Pino (DestinationStream): cada write é uma linha JSON. */
  readonly destino: { write: (linha: string) => void };
  readonly linhas: LinhaDeLog[];
}

export function capturarLogs(): CapturaDeLogs {
  const linhas: LinhaDeLog[] = [];
  return {
    destino: { write: (linha: string) => linhas.push(JSON.parse(linha) as LinhaDeLog) },
    linhas,
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
