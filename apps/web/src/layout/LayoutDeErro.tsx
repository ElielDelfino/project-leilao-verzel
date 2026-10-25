import { PaginaDeErro } from '../paginas/PaginaDeErro';
import { Rodape } from './Rodape';
import { ID_CONTEUDO } from './site';

/**
 * errorElement da rota raiz: só é usado quando o próprio LayoutBase falha (erros das páginas
 * ficam dentro do layout). Por isso não reusa o cabeçalho, que pode ser a origem da falha.
 */
export function LayoutDeErro() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main id={ID_CONTEUDO} tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <PaginaDeErro />
      </main>
      <Rodape />
    </div>
  );
}
