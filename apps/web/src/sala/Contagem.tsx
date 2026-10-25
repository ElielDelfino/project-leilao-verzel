import { useEffect, useState } from 'react';

import { formatarDataHora } from '../formatacao/data';

const SEGUNDO_MS = 1000;
const DIA_S = 86_400;
const HORA_S = 3600;
const MINUTO_S = 60;

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** "HH:MM:SS", ou "{d} d HH:MM:SS" a partir de um dia. Nunca negativo. */
export function formatarRestante(restanteMs: number): string {
  const total = Math.max(0, Math.ceil(restanteMs / SEGUNDO_MS));
  const dias = Math.floor(total / DIA_S);
  const horas = Math.floor((total % DIA_S) / HORA_S);
  const minutos = Math.floor((total % HORA_S) / MINUTO_S);
  const hhmmss = `${doisDigitos(horas)}:${doisDigitos(minutos)}:${doisDigitos(total % MINUTO_S)}`;
  return dias > 0 ? `${dias} d ${hhmmss}` : hhmmss;
}

/** Relógio do servidor estimado: relógio local + deslocamento, atualizado a cada segundo. */
function useAgoraDoServidor(deslocamentoMs: number): number {
  const [agora, setAgora] = useState(() => Date.now() + deslocamentoMs);
  useEffect(() => {
    setAgora(Date.now() + deslocamentoMs);
    const id = setInterval(() => setAgora(Date.now() + deslocamentoMs), SEGUNDO_MS);
    return () => clearInterval(id);
  }, [deslocamentoMs]);
  return agora;
}

interface Props {
  fimEm: string;
  deslocamentoMs: number;
  fimEstendido: boolean;
}

export function Contagem({ fimEm, deslocamentoMs, fimEstendido }: Props) {
  const agora = useAgoraDoServidor(deslocamentoMs);
  const restanteMs = Date.parse(fimEm) - agora;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {/* Sem aria-live: não anuncia a cada segundo. */}
      <p role="timer" className="text-2xl font-bold tabular-nums">
        {restanteMs > 0 ? `Termina em ${formatarRestante(restanteMs)}` : 'Encerrando…'}
      </p>
      <p className="text-texto-suave">Fim: {formatarDataHora(fimEm)}</p>
      {fimEstendido ? (
        <p className="rounded-md border-2 border-current px-2 py-1 font-bold">
          <span aria-hidden="true">⏱</span> Fim estendido
        </p>
      ) : null}
    </div>
  );
}
