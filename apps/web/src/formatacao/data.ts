// A API envia instantes em UTC (ISO 8601); a UI exibe em America/Sao_Paulo (ADR 0001, specs/012).
const FUSO = 'America/Sao_Paulo';

const formatoDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  dateStyle: 'short',
  timeStyle: 'short',
});

const formatoData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short' });

function paraDate(valor: string | Date): Date {
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(data.getTime())) {
    throw new RangeError(`Data inválida: ${String(valor)}`);
  }
  return data;
}

/** Ex.: "2026-10-24T13:00:00Z" → "24/10/2026, 10:00". */
export function formatarDataHora(valor: string | Date): string {
  return formatoDataHora.format(paraDate(valor));
}

/** Ex.: "2026-10-25T02:30:00Z" → "24/10/2026". */
export function formatarData(valor: string | Date): string {
  return formatoData.format(paraDate(valor));
}
