import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';

import { Cabecalho } from './Cabecalho';
import { Rodape } from './Rodape';
import { ID_CONTEUDO } from './site';

/**
 * Ao trocar de rota numa SPA, leva o foco ao conteúdo para teclado e leitor de tela
 * (specs/012 §Comportamento): só quando o pathname muda; nunca na primeira carga nem quando só
 * mudam a query string ou o hash.
 */
function useFocoAoTrocarDeRota() {
  const { pathname } = useLocation();
  const conteudo = useRef<HTMLElement>(null);
  // Guarda o caminho anterior (e não um "primeira vez") para não roubar o foco na carga,
  // nem com o efeito duplicado do StrictMode.
  const caminhoAnterior = useRef(pathname);

  useEffect(() => {
    if (caminhoAnterior.current === pathname) return;
    caminhoAnterior.current = pathname;
    conteudo.current?.focus();
  }, [pathname]);

  return conteudo;
}

export function LayoutBase() {
  const conteudo = useFocoAoTrocarDeRota();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href={`#${ID_CONTEUDO}`}
        className="sr-only rounded-md bg-primario px-4 py-2 font-medium text-texto-sobre-primario focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Pular para o conteúdo
      </a>
      <Cabecalho />
      <main
        id={ID_CONTEUDO}
        ref={conteudo}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8"
      >
        <Outlet />
      </main>
      <Rodape />
    </div>
  );
}
