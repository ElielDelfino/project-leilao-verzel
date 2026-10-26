import type { ReactNode } from 'react';

import type { PosicaoDoLicitante } from '../api/arremates';

interface Visual {
  rotulo: string;
  icone: ReactNode;
}

// Ícones no estilo do AlternarTema: decorativos (aria-hidden), o significado vai no texto.
const VISUAIS: Record<PosicaoDoLicitante, Visual> = {
  // check
  ganhando: {
    rotulo: 'Você está ganhando',
    icone: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  },
  // alerta
  superado: {
    rotulo: 'Você foi superado',
    icone: (
      <>
        <path d="M12 3L2 20h20L12 3z" />
        <path d="M12 10v4M12 17.5v.5" />
      </>
    ),
  },
  // troféu
  venceu: {
    rotulo: 'Você venceu',
    icone: (
      <>
        <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
        <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
        <path d="M12 14v4M8 21h8M9 18h6" />
      </>
    ),
  },
  // "x"
  perdeu: {
    rotulo: 'Você não venceu',
    icone: <path d="M6 6l12 12M18 6L6 18" />,
  },
};

export function rotuloDaPosicao(posicao: PosicaoDoLicitante): string {
  return VISUAIS[posicao].rotulo;
}

export function RotuloDePosicao({ posicao }: { posicao: PosicaoDoLicitante }) {
  const { rotulo, icone } = VISUAIS[posicao];
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-borda-controle px-2 py-1 text-sm font-semibold">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icone}
      </svg>
      {rotulo}
    </span>
  );
}
