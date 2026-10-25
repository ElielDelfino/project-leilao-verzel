// Descrição de uma falha de dependência (Postgres, Redis) para o log, sem host, porta nem senha
// (specs/014 §Observabilidade: "O nome da dependência e o motivo vão só para o log (warn), sem host
// nem senha"). A mensagem dos drivers é descartada: a de conexão traz host e porta
// ("connect ECONNREFUSED 127.0.0.1:5432") e a do Drizzle traz SQL e parâmetros.

/** Nome de classe de erro (ErroDoBanco, AbortError, TempoEsgotado...). */
const NOME_SEGURO = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Código de sistema (ECONNREFUSED, ETIMEDOUT) ou SQLSTATE (28P01, 57P01). */
const CODIGO_SEGURO = /^[A-Z0-9_]{1,64}$/;

function campoDeTexto(erro: object, campo: string): string | undefined {
  try {
    const valor: unknown = (erro as Record<string, unknown>)[campo];
    return typeof valor === 'string' ? valor : undefined;
  } catch {
    return undefined;
  }
}

/** Código do erro: `code` (Node, pg) ou `codigo` (ErroDoBanco, ErroDoRedis), se tiver o formato. */
export function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro !== 'object' || erro === null) {
    return undefined;
  }
  const codigo = campoDeTexto(erro, 'code') ?? campoDeTexto(erro, 'codigo');
  return codigo !== undefined && CODIGO_SEGURO.test(codigo) ? codigo : undefined;
}

/** "Tipo (CODIGO)", por exemplo "ErroDoBanco (ECONNREFUSED)"; nunca a mensagem do erro. */
export function descreverFalhaSemDetalhes(erro: unknown): string {
  if (!(erro instanceof Error)) {
    return 'motivo desconhecido';
  }
  const nome = campoDeTexto(erro, 'name');
  const tipo = nome !== undefined && NOME_SEGURO.test(nome) ? nome : 'Error';
  const codigo = codigoDoErro(erro);
  return codigo === undefined ? tipo : `${tipo} (${codigo})`;
}
