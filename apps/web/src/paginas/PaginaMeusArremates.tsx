import type { KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';

import { listarMeusArremates, listarMeusLances } from '../api/arremates';
import { tituloDaPagina } from '../layout/site';
import { ABAS, escreverEstado, lerEstado, type Aba } from '../meus-arremates/estado-da-url';
import { ItemDeArremate, ItemDeLance } from '../meus-arremates/Itens';
import { ListaPaginada } from '../meus-arremates/ListaPaginada';
import { IndicadorDeslizante } from '../layout/IndicadorDeslizante';

const TITULO = 'Meus arremates';
const ID_PAINEL = 'painel-meus-arremates';
const ROTULOS: Record<Aba, string> = { lances: 'Meus lances', arrematados: 'Arrematados' };
const idDaAba = (aba: Aba) => `aba-${aba}`;

export function PaginaMeusArremates() {
  const [params, setParams] = useSearchParams();
  const { aba, pagina } = lerEstado(params);

  // Cada troca de aba ou página é uma entrada de histórico; só a correção de página substitui.
  const irParaPagina = (nova: number, substituir = false) =>
    setParams(escreverEstado({ aba, pagina: nova }), { replace: substituir });
  const irParaAba = (nova: Aba) => setParams(escreverEstado({ aba: nova, pagina: 1 }));

  function teclaNaAba(evento: KeyboardEvent<HTMLButtonElement>) {
    const passo = evento.key === 'ArrowRight' ? 1 : evento.key === 'ArrowLeft' ? -1 : 0;
    if (passo === 0) return;
    evento.preventDefault();
    const proxima = ABAS[(ABAS.indexOf(aba) + passo + ABAS.length) % ABAS.length];
    if (proxima === undefined) return;
    irParaAba(proxima);
    document.getElementById(idDaAba(proxima))?.focus();
  }

  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="titulo-pagina">{TITULO}</h1>

      <div role="tablist" aria-label="Seções de Meus arremates" className="pilulas mt-6">
        <IndicadorDeslizante />
        {ABAS.map((a) => {
          const selecionada = a === aba;
          return (
            <button
              key={a}
              id={idDaAba(a)}
              type="button"
              role="tab"
              aria-selected={selecionada}
              aria-controls={ID_PAINEL}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => irParaAba(a)}
              onKeyDown={teclaNaAba}
              className="pilula min-h-11 cursor-pointer"
            >
              {ROTULOS[a]}
            </button>
          );
        })}
      </div>

      <div id={ID_PAINEL} role="tabpanel" aria-labelledby={idDaAba(aba)} className="mt-6">
        {/* O `key` por aba remonta a lista: o placeholder nunca mostra itens da outra aba. */}
        {aba === 'lances' ? (
          <ListaPaginada
            key="lances"
            chave="lances"
            rotulo="Meus lances"
            carregando="Carregando seus lances…"
            pagina={pagina}
            buscar={listarMeusLances}
            chaveDoItem={(item) => item.lote.id}
            renderizar={(item) => <ItemDeLance item={item} />}
            irParaPagina={irParaPagina}
            vazio={<p className="aviso">Você ainda não deu nenhum lance.</p>}
          />
        ) : (
          <ListaPaginada
            key="arrematados"
            chave="arrematados"
            rotulo="Arrematados"
            carregando="Carregando seus arremates…"
            pagina={pagina}
            buscar={listarMeusArremates}
            chaveDoItem={(item) => item.codigo}
            renderizar={(item) => <ItemDeArremate item={item} />}
            irParaPagina={irParaPagina}
            vazio={<p className="aviso">Você ainda não arrematou nenhum lote.</p>}
          />
        )}
      </div>
    </>
  );
}
