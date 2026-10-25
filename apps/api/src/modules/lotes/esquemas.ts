// Entradas da tag painel (openapi.yaml: LoteEntrada, PaginaLimitada; specs/006 §Criação e
// §Painel). Erro de campo sai em `detalhes.campo` (422 DADOS_INVALIDOS) com o primeiro campo
// inválido na ordem do corpo. Tamanhos contam caracteres (code points), como o JSON Schema.
import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { ErroApi } from '../../common/erros/erro-api.js';
import { CENTAVOS_MAXIMO_DO_LOTE, CENTAVOS_MINIMO_DO_LOTE } from './schema.js';

export const TITULO_MAXIMO = 120;
export const DESCRICAO_MAXIMA = 2000;
export const LOTES_POR_PAGINA = 24;
export const PAGINA_MAXIMA = 500;

const SEGUNDO_MS = 1000;
const MINUTO_MS = 60 * SEGUNDO_MS;
/** Início aceito até 1 minuto no passado (specs/006 §Criação). */
const TOLERANCIA_DO_INICIO_MS = MINUTO_MS;
/** Iguais aos CHECKs lots_duracao_minima e lots_duracao_maxima (schema.ts). */
const DURACAO_MINIMA_MS = 5 * MINUTO_MS;
const DURACAO_MAXIMA_MS = 7 * 24 * 60 * MINUTO_MS;

/** Campo desconhecido citado em `detalhes.campo` só se for um nome curto e simples. */
const NOME_DE_CAMPO_SEGURO = /^\w{1,64}$/;
const CAMPO_DO_CORPO = 'corpo';

const CAMPOS = [
  'scryfallId',
  'titulo',
  'descricao',
  'lanceInicialCentavos',
  'incrementoMinimoCentavos',
  'inicioEm',
  'fimEm',
] as const;
type CampoDoLote = (typeof CAMPOS)[number];
const CONJUNTO_DE_CAMPOS: ReadonlySet<string> = new Set(CAMPOS);

export interface NovoLoteValidado {
  readonly scryfallId: string;
  /** Sem os espaços das pontas; null = usar o nome da carta. */
  readonly titulo: string | null;
  /** Sem os espaços das pontas; null = sem descrição. */
  readonly descricao: string | null;
  readonly lanceInicialCentavos: number;
  readonly incrementoMinimoCentavos: number;
  readonly inicioEm: Date;
  readonly fimEm: Date;
}

export type ResultadoDaValidacao =
  | { readonly ok: true; readonly dados: NovoLoteValidado }
  | { readonly ok: false; readonly campo: string };

function caracteres(texto: string): number {
  return [...texto].length;
}

function textoOpcional(maximo: number, minimo: number) {
  return z
    .union([z.string().refine((t) => caracteres(t) >= minimo && caracteres(t) <= maximo), z.null()])
    .optional()
    .transform((t) => {
      const aparado = t?.trim() ?? '';
      return aparado === '' ? null : aparado;
    });
}

const centavos = z.int().min(CENTAVOS_MINIMO_DO_LOTE).max(CENTAVOS_MAXIMO_DO_LOTE);
const instante = z.iso.datetime({ offset: true }).transform((t) => new Date(t));

const ESQUEMAS_DOS_CAMPOS = {
  scryfallId: z.uuid(),
  titulo: textoOpcional(TITULO_MAXIMO, 1),
  descricao: textoOpcional(DESCRICAO_MAXIMA, 0),
  lanceInicialCentavos: centavos,
  incrementoMinimoCentavos: centavos,
  inicioEm: instante,
  fimEm: instante,
} satisfies Record<CampoDoLote, z.ZodType>;

function ehObjetoSimples(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function falhou(campo: string): ResultadoDaValidacao {
  return { ok: false, campo };
}

/** Regras de horário (specs/006 §Criação), com `agoraMs` do relógio da API. */
function campoDeHorarioInvalido(inicio: Date, fim: Date, agoraMs: number): CampoDoLote | undefined {
  if (Number.isNaN(inicio.getTime()) || inicio.getTime() < agoraMs - TOLERANCIA_DO_INICIO_MS) {
    return 'inicioEm';
  }
  const duracao = fim.getTime() - inicio.getTime();
  if (Number.isNaN(duracao) || duracao < DURACAO_MINIMA_MS || duracao > DURACAO_MAXIMA_MS) {
    return 'fimEm';
  }
  return undefined;
}

/**
 * Valida o corpo de `POST /api/painel/lotes`: campos desconhecidos primeiro, depois cada campo na
 * ordem do corpo; as regras de horário entram na posição de `inicioEm` e `fimEm`.
 */
export function validarNovoLote(corpo: unknown, agoraMs: number): ResultadoDaValidacao {
  if (!ehObjetoSimples(corpo)) return falhou(CAMPO_DO_CORPO);
  const desconhecido = Object.keys(corpo).find((chave) => !CONJUNTO_DE_CAMPOS.has(chave));
  if (desconhecido !== undefined) {
    return falhou(NOME_DE_CAMPO_SEGURO.test(desconhecido) ? desconhecido : CAMPO_DO_CORPO);
  }
  const lidos: Partial<Record<CampoDoLote, unknown>> = {};
  for (const campo of CAMPOS) {
    const resultado = ESQUEMAS_DOS_CAMPOS[campo].safeParse(corpo[campo]);
    if (!resultado.success) return falhou(campo);
    lidos[campo] = resultado.data;
  }
  const dados = lidos as NovoLoteValidado;
  const horario = campoDeHorarioInvalido(dados.inicioEm, dados.fimEm, agoraMs);
  return horario === undefined ? { ok: true, dados } : falhou(horario);
}

/** Título gravado: o informado ou o nome da carta truncado em 120 caracteres. */
export function tituloDoLote(titulo: string | null, nomeDaCarta: string): string {
  return titulo ?? [...nomeDaCarta].slice(0, TITULO_MAXIMO).join('');
}

export function dadosInvalidos(campo: string): ErroApi {
  return new ErroApi({
    codigo: 'DADOS_INVALIDOS',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    mensagem: 'Dados inválidos.',
    detalhes: { campo },
  });
}

/** Corpo da criação → NovoLoteValidado ou 422 com `detalhes.campo`. */
export class PipeDoNovoLote implements PipeTransform<unknown, NovoLoteValidado> {
  transform(corpo: unknown): NovoLoteValidado {
    const resultado = validarNovoLote(corpo, Date.now());
    if (!resultado.ok) throw dadosInvalidos(resultado.campo);
    return resultado.dados;
  }
}

/** `pagina`: inteiro decimal de 1 a 500, sem zeros à esquerda; ausente → 1 (repetida → 422). */
export const esquemaDaPaginaDoPainel = z
  .string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.int().min(1).max(PAGINA_MAXIMA))
  .optional()
  .transform((pagina) => pagina ?? 1);

export class PipeDaPaginaDoPainel implements PipeTransform<unknown, number> {
  readonly #esquema: typeof esquemaDaPaginaDoPainel;

  constructor(esquema: typeof esquemaDaPaginaDoPainel) {
    this.#esquema = esquema;
  }

  transform(valor: unknown): number {
    const resultado = this.#esquema.safeParse(valor);
    if (!resultado.success) throw dadosInvalidos('pagina');
    return resultado.data;
  }
}
