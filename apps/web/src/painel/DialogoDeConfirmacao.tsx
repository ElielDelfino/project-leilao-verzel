import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface Props {
  titulo: string;
  /** Fechar sem confirmar (Esc). Ignorado enquanto `ocupado`. */
  aoFechar: () => void;
  /** Botão que abriu o diálogo: recebe o foco de volta ao fechar. */
  origem: RefObject<HTMLElement | null>;
  ocupado: boolean;
  /** Elemento que recebe o foco inicial. */
  focoInicial: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

const FOCAVEIS = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]';

/** Diálogo modal acessível: foco preso, Esc fecha, devolve o foco à origem (WCAG 2.1.2, 2.4.3). */
export function DialogoDeConfirmacao({
  titulo,
  aoFechar,
  origem,
  ocupado,
  focoInicial,
  children,
}: Props) {
  const idDoTitulo = useId();
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const botaoDeOrigem = origem.current;
    focoInicial.current?.focus();
    return () => {
      // O botão pode ter saído da lista (lote cancelado); sem ele não há onde devolver.
      if (botaoDeOrigem?.isConnected) botaoDeOrigem.focus();
    };
    // Só na abertura e no fechamento.
  }, []);

  // Botões desabilitados perdem o foco; mantém o foco dentro do diálogo.
  useEffect(() => {
    if (ocupado) raiz.current?.focus();
  }, [ocupado]);

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      if (!ocupado) aoFechar();
      return;
    }
    if (evento.key !== 'Tab') return;
    const focaveis = Array.from(raiz.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? []);
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (!primeiro || !ultimo) {
      evento.preventDefault();
      raiz.current?.focus();
    } else if (evento.shiftKey && document.activeElement === primeiro) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    } else if (!raiz.current?.contains(document.activeElement)) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={raiz}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        tabIndex={-1}
        onKeyDown={aoTeclar}
        className="cartao w-full max-w-md p-6 text-texto shadow-2xl"
      >
        <h2 id={idDoTitulo} className="text-xl font-bold">
          {titulo}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
