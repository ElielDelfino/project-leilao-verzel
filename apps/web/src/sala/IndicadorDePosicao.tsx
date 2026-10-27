import { formatarCentavos } from '../formatacao/dinheiro';
import type { PosicaoNoLote } from './estadoDaSala';

interface Props {
  posicao: PosicaoNoLote | undefined;
  lanceAtualCentavos: number | null;
}

const CLASSES = 'flex items-center gap-3 rounded-xl border p-4 font-bold';
const CLASSE_ICONE = 'grid size-7 shrink-0 place-items-center rounded-full text-fundo';

/** Cor nunca é o único sinal: ícone (decorativo) e texto. `sem_lance` não mostra nada. */
export function IndicadorDePosicao({ posicao, lanceAtualCentavos }: Props) {
  switch (posicao) {
    case 'ganhando':
      return (
        <p className={`${CLASSES} border-sucesso bg-sucesso/10 text-sucesso`}>
          <span aria-hidden="true" className={`${CLASSE_ICONE} bg-sucesso`}>
            ✓
          </span>{' '}
          Você está ganhando este lote.
        </p>
      );
    case 'superado':
      return (
        <p className={`${CLASSES} border-perigo bg-perigo/10 text-perigo`}>
          <span aria-hidden="true" className={`${CLASSE_ICONE} bg-perigo`}>
            ⚠
          </span>{' '}
          Você foi superado. O lance atual é {formatarCentavos(lanceAtualCentavos ?? 0)}.
        </p>
      );
    case 'venceu':
      return <p className="font-bold text-sucesso">Você venceu este lote.</p>;
    case 'perdeu':
      return <p className="font-bold text-texto-suave">Você não venceu este lote.</p>;
    default:
      return null;
  }
}
