import { useLayoutEffect, useRef, useState } from 'react';

interface Caixa {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

const SELETOR_DA_ATIVA = '[aria-selected="true"], [aria-current="page"]';

function medir(grupo: HTMLElement): Caixa | null {
  const ativa = grupo.querySelector<HTMLElement>(SELETOR_DA_ATIVA);
  // Sem layout (jsdom) ou sem pílula ativa: o fundo estático da pílula continua valendo.
  if (!ativa || ativa.offsetWidth === 0) return null;
  return {
    x: ativa.offsetLeft,
    y: ativa.offsetTop,
    largura: ativa.offsetWidth,
    altura: ativa.offsetHeight,
  };
}

/**
 * Fundo da pílula ativa que desliza até a nova ativa, como a navegação da OMG. Vai como primeiro
 * filho de `.pilulas` e só observa o DOM (aria-selected/aria-current): nenhuma lógica muda.
 */
export function IndicadorDeslizante() {
  const ref = useRef<HTMLSpanElement>(null);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  // A primeira posição aparece sem animação; só as trocas seguintes deslizam.
  const [animar, setAnimar] = useState(false);

  useLayoutEffect(() => {
    const grupo = ref.current?.parentElement;
    if (!grupo) return;
    const atualizar = () => setCaixa(medir(grupo));
    atualizar();
    const quadro = requestAnimationFrame(() => setAnimar(true));

    const mutacoes = new MutationObserver(atualizar);
    mutacoes.observe(grupo, {
      subtree: true,
      childList: true,
      attributeFilter: ['aria-selected', 'aria-current'],
    });
    // Fonte carregando e troca de largura da tela mudam o tamanho das pílulas.
    const tamanhos = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(atualizar);
    tamanhos?.observe(grupo);
    for (const filho of grupo.children) tamanhos?.observe(filho);

    return () => {
      cancelAnimationFrame(quadro);
      mutacoes.disconnect();
      tamanhos?.disconnect();
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-visivel={caixa ? '' : undefined}
      data-animar={animar ? '' : undefined}
      className="indicador-pilula"
      style={
        caixa
          ? {
              width: caixa.largura,
              height: caixa.altura,
              transform: `translate(${caixa.x}px, ${caixa.y}px)`,
            }
          : undefined
      }
    />
  );
}
