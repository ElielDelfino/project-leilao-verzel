// Tipos da sessão compartilhados pelos módulos (specs/003; guards em common/auth, ADR 0025).

/** Papéis de specs/003 RF-01 (enum `papel_usuario` do banco). */
export const PAPEIS = ['leiloeiro', 'licitante'] as const;
export type PapelDoUsuario = (typeof PAPEIS)[number];

/** O que o access token carrega: só o id e o papel, nunca nome nem e-mail (specs/003). */
export interface UsuarioDaSessao {
  readonly id: string;
  readonly papel: PapelDoUsuario;
}

export function ehPapel(valor: unknown): valor is PapelDoUsuario {
  return (PAPEIS as readonly unknown[]).includes(valor);
}
