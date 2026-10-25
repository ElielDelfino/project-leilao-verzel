// Datas do formulário do novo lote: `datetime-local` é lido em America/Sao_Paulo (specs/012).
const FUSO = 'America/Sao_Paulo';
const FORMATO_CAMPO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const formatoPartes = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Deslocamento (ms) do fuso em relação ao UTC no instante dado (negativo a oeste). */
function deslocamentoDoFuso(instanteMs: number): number {
  const partes: Record<string, number> = {};
  for (const parte of formatoPartes.formatToParts(new Date(instanteMs))) {
    if (parte.type !== 'literal') partes[parte.type] = Number(parte.value);
  }
  const comoUtc = Date.UTC(
    partes['year'] ?? 0,
    (partes['month'] ?? 1) - 1,
    partes['day'] ?? 1,
    partes['hour'] ?? 0,
    partes['minute'] ?? 0,
    partes['second'] ?? 0,
  );
  return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

/** "2026-10-26T10:30" (horário de São Paulo) → instante; null se vazio ou inexistente. */
export function campoParaInstante(valor: string): Date | null {
  const partes = FORMATO_CAMPO.exec(valor.trim());
  if (!partes) return null;
  const [ano, mes, dia, hora, minuto, segundo] = partes.slice(1).map((p) => Number(p ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const comoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  const conferido = new Date(comoUtc);
  if (
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== dia ||
    hora > 23 ||
    minuto > 59 ||
    segundo > 59
  ) {
    return null;
  }
  // Uma segunda passada cobre a troca de deslocamento perto de uma mudança de horário.
  const primeiro = comoUtc - deslocamentoDoFuso(comoUtc);
  return new Date(comoUtc - deslocamentoDoFuso(primeiro));
}
