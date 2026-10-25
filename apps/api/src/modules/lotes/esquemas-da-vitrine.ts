// Parâmetros de `GET /api/lotes` (specs/006 §Vitrine; openapi.yaml lotesListar). Todos opcionais;
// fora do contrato (inclusive repetido ou desconhecido) → 422 DADOS_INVALIDOS com `detalhes.campo`
// = o primeiro inválido na ordem do contrato. `precoMin` > `precoMax` → campo `precoMax`.
import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { dadosInvalidos, esquemaDaPaginaDoPainel } from './esquemas.js';

export const STATUS_DA_VITRINE = ['ao_vivo', 'agendado', 'encerrado'] as const;
export const RARIDADES = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'] as const;
export const ORDENS = ['termina_antes', 'mais_recente', 'maior_lance'] as const;

export type StatusDaVitrine = (typeof STATUS_DA_VITRINE)[number];
export type Raridade = (typeof RARIDADES)[number];
export type OrdemDaVitrine = (typeof ORDENS)[number];

const Q_MAXIMO = 100;
const PRECO_MAXIMO = 10_000_000_000;
const CAMPO_DA_CONSULTA = 'consulta';
const NOME_DE_CAMPO_SEGURO = /^\w{1,64}$/;

export interface FiltrosDaVitrine {
  readonly status: StatusDaVitrine | null;
  /** Sem espaços nas pontas; null = sem busca. */
  readonly q: string | null;
  readonly precoMin: number | null;
  readonly precoMax: number | null;
  readonly raridade: Raridade | null;
  readonly ordem: OrdemDaVitrine;
  readonly pagina: number;
}

export type ResultadoDosFiltros =
  | { readonly ok: true; readonly filtros: FiltrosDaVitrine }
  | { readonly ok: false; readonly campo: string };

const opcionalOuNull = <T extends z.ZodType>(esquema: T) =>
  esquema.optional().transform((v) => v ?? null);

/** Centavos de 0 a 10.000.000.000, decimal sem sinal nem zeros à esquerda. */
const preco = opcionalOuNull(
  z
    .string()
    .regex(/^(0|[1-9]\d{0,10})$/)
    .transform(Number)
    .pipe(z.int().max(PRECO_MAXIMO)),
);

const ESQUEMAS = {
  status: opcionalOuNull(z.enum(STATUS_DA_VITRINE)),
  q: opcionalOuNull(
    z
      .string()
      .transform((t) => t.trim())
      .refine((t) => {
        const tamanho = [...t].length;
        return tamanho >= 1 && tamanho <= Q_MAXIMO;
      }),
  ),
  precoMin: preco,
  precoMax: preco,
  raridade: opcionalOuNull(z.enum(RARIDADES)),
  ordem: z
    .enum(ORDENS)
    .optional()
    .transform((o) => o ?? 'termina_antes'),
  pagina: esquemaDaPaginaDoPainel,
} as const;

type CampoDaVitrine = keyof typeof ESQUEMAS;
const CAMPOS = Object.keys(ESQUEMAS) as CampoDaVitrine[];
const CONJUNTO_DE_CAMPOS: ReadonlySet<string> = new Set(CAMPOS);

export function validarFiltrosDaVitrine(
  consulta: Readonly<Record<string, unknown>>,
): ResultadoDosFiltros {
  const desconhecido = Object.keys(consulta).find((chave) => !CONJUNTO_DE_CAMPOS.has(chave));
  if (desconhecido !== undefined) {
    return {
      ok: false,
      campo: NOME_DE_CAMPO_SEGURO.test(desconhecido) ? desconhecido : CAMPO_DA_CONSULTA,
    };
  }
  const lidos: Partial<Record<CampoDaVitrine, unknown>> = {};
  for (const campo of CAMPOS) {
    const resultado = ESQUEMAS[campo].safeParse(consulta[campo]);
    if (!resultado.success) return { ok: false, campo };
    lidos[campo] = resultado.data;
  }
  const filtros = lidos as FiltrosDaVitrine;
  if (
    filtros.precoMin !== null &&
    filtros.precoMax !== null &&
    filtros.precoMin > filtros.precoMax
  ) {
    return { ok: false, campo: 'precoMax' };
  }
  return { ok: true, filtros };
}

/** `%`, `_` e `\` como texto literal num ILIKE (o escape padrão do Postgres é `\`). */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Query string inteira → FiltrosDaVitrine ou 422 com `detalhes.campo`. */
export class PipeDaVitrine implements PipeTransform<unknown, FiltrosDaVitrine> {
  transform(consulta: unknown): FiltrosDaVitrine {
    const objeto =
      consulta !== null && typeof consulta === 'object'
        ? (consulta as Readonly<Record<string, unknown>>)
        : {};
    const resultado = validarFiltrosDaVitrine(objeto);
    if (!resultado.ok) throw dadosInvalidos(resultado.campo);
    return resultado.filtros;
  }
}
