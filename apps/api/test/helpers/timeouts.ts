// Constante única dos testes que fazem rajada, espera, reconexão ou disputam o Postgres com outras
// suítes (specs/013): o padrão de 5 s do Vitest não basta e cada arquivo repetia o seu número.

/** Timeout dos testes longos (90 s). */
export const TIMEOUT_LONGO_MS = 90_000;
