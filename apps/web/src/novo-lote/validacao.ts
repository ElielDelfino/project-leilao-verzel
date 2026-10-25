import type { LoteEntrada } from '../api/catalogo';
import { precoParaCentavos } from '../lotes/precoEmReais';
import { campoParaInstante } from './datas';

// Limites de specs/006 §Criação, espelhados no navegador; o servidor continua a autoridade.
export const LANCE_MINIMO_CENTAVOS = 100;
export const LANCE_MAXIMO_CENTAVOS = 100_000_000;
const UM_MINUTO_MS = 60_000;
const CINCO_MINUTOS_MS = 5 * UM_MINUTO_MS;
const SETE_DIAS_MS = 7 * 24 * 60 * UM_MINUTO_MS;

export const MENSAGEM_VALOR = 'Informe um valor entre R$ 1,00 e R$ 1.000.000,00.';
export const MENSAGEM_DATA_VAZIA = 'Informe a data e a hora.';
export const MENSAGEM_INICIO_NO_PASSADO = 'O início não pode ser mais de 1 minuto no passado.';
export const MENSAGEM_FIM_CURTO = 'O fim deve ser pelo menos 5 minutos depois do início.';
export const MENSAGEM_DURACAO = 'A duração máxima é de 7 dias.';

export const CAMPOS_DO_LOTE = ['lanceInicial', 'incremento', 'inicio', 'fim'] as const;
export type CampoDoLote = (typeof CAMPOS_DO_LOTE)[number];
export type ErrosDoLote = Partial<Record<CampoDoLote, string>>;

export interface CamposDoLote {
  scryfallId: string;
  titulo: string;
  descricao: string;
  lanceInicial: string;
  incremento: string;
  comecarAgora: boolean;
  inicio: string;
  fim: string;
}

export type ResultadoDaValidacao =
  { ok: true; entrada: LoteEntrada } | { ok: false; erros: ErrosDoLote };

function lerValor(texto: string): number | null {
  const centavos = precoParaCentavos(texto);
  return centavos !== null && centavos >= LANCE_MINIMO_CENTAVOS && centavos <= LANCE_MAXIMO_CENTAVOS
    ? centavos
    : null;
}

function erroDoFim(inicio: Date | null, fim: Date | null, fimTexto: string): string | undefined {
  if (fimTexto.trim() === '' || fim === null) return MENSAGEM_DATA_VAZIA;
  if (inicio === null) return undefined;
  const duracao = fim.getTime() - inicio.getTime();
  if (duracao < CINCO_MINUTOS_MS) return MENSAGEM_FIM_CURTO;
  if (duracao > SETE_DIAS_MS) return MENSAGEM_DURACAO;
  return undefined;
}

/** Valida no navegador e monta o corpo de `POST /api/painel/lotes`; `agora` é o instante do envio. */
export function validarLote(campos: CamposDoLote, agora: Date): ResultadoDaValidacao {
  const lanceInicial = lerValor(campos.lanceInicial);
  const incremento = lerValor(campos.incremento);
  const inicio = campos.comecarAgora ? agora : campoParaInstante(campos.inicio);
  const fim = campoParaInstante(campos.fim);

  const erros: ErrosDoLote = {};
  if (lanceInicial === null) erros.lanceInicial = MENSAGEM_VALOR;
  if (incremento === null) erros.incremento = MENSAGEM_VALOR;
  if (inicio === null) erros.inicio = MENSAGEM_DATA_VAZIA;
  else if (inicio.getTime() < agora.getTime() - UM_MINUTO_MS) {
    erros.inicio = MENSAGEM_INICIO_NO_PASSADO;
  }
  const erroFim = erroDoFim(inicio, fim, campos.fim);
  if (erroFim !== undefined) erros.fim = erroFim;

  if (
    Object.keys(erros).length > 0 ||
    lanceInicial === null ||
    incremento === null ||
    inicio === null ||
    fim === null
  ) {
    return { ok: false, erros };
  }

  const titulo = campos.titulo.trim();
  const descricao = campos.descricao.trim();
  return {
    ok: true,
    entrada: {
      scryfallId: campos.scryfallId,
      ...(titulo === '' ? {} : { titulo }),
      ...(descricao === '' ? {} : { descricao }),
      lanceInicialCentavos: lanceInicial,
      incrementoMinimoCentavos: incremento,
      inicioEm: inicio.toISOString(),
      fimEm: fim.toISOString(),
    },
  };
}
