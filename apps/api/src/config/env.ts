// Validação do env no boot (specs/014 §Segredos: "A API valida o env com Zod no boot e falha rápido").
// Só entram aqui as variáveis que a API já usa; cada módulo acrescenta as suas quando nascer.
import { z } from 'zod';

const NIVEIS_DE_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65_535;

const esquemaDoEnv = z.object({
  API_PORT: z.coerce.number().int().min(PORTA_MINIMA).max(PORTA_MAXIMA),
  LOG_LEVEL: z.enum(NIVEIS_DE_LOG).default('info'),
});

export type Env = z.infer<typeof esquemaDoEnv>;
export type NivelDeLog = Env['LOG_LEVEL'];

/** Token de injeção do env já validado. */
export const ENV = Symbol('ENV');

/** Env inválido. A mensagem cita só os nomes das variáveis, nunca os valores recebidos. */
export class ErroDeConfiguracao extends Error {
  override readonly name = 'ErroDeConfiguracao';
}

function descreverProblema(problema: z.core.$ZodIssue): string {
  const variavel = problema.path.map(String).join('.') || '(raiz)';
  return `${variavel} (${problema.code})`;
}

export function carregarEnv(origem: Readonly<Record<string, string | undefined>>): Env {
  const resultado = esquemaDoEnv.safeParse(origem);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map(descreverProblema).join(', ');
    throw new ErroDeConfiguracao(`Variáveis de ambiente inválidas ou ausentes: ${problemas}`);
  }
  return resultado.data;
}
