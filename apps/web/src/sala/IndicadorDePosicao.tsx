import { formatarCentavos } from '../formatacao/dinheiro';
import type { PosicaoNoLote } from './estadoDaSala';

interface Props {
  posicao: PosicaoNoLote | undefined;
  lanceAtualCentavos: number | null;
}

const CLASSES = 'flex items-center gap-2 rounded-md border-2 border-current p-3 font-bold';

/** Cor nunca é o único sinal: ícone (decorativo) e texto. `sem_lance` não mostra nada. */
export function IndicadorDePosicao({ posicao, lanceAtualCentavos }: Props) {
  switch (posicao) {
    case 'ganhando':
      return (
        <p className={CLASSES}>
          <span aria-hidden="true">✓</span> Você está ganhando este lote.
        </p>
      );
    case 'superado':
      return (
        <p className={CLASSES}>
          <span aria-hidden="true">⚠</span> Você foi superado. O lance atual é{' '}
          {formatarCentavos(lanceAtualCentavos ?? 0)}.
        </p>
      );
    case 'venceu':
      return <p className="font-bold">Você venceu este lote.</p>;
    case 'perdeu':
      return <p className="font-bold">Você não venceu este lote.</p>;
    default:
      return null;
  }
}
