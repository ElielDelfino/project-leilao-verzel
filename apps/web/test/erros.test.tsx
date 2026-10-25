import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { violacoesSerias } from './apoio/axe';
import { simularPreferenciaDoSistema } from './apoio/matchMedia';
import { renderizarApp } from './apoio/renderizarApp';

// Falhas simuladas: uma página (dentro do layout) ou o próprio layout (o botão de tema do cabeçalho).
const falhas = vi.hoisted(() => ({ pagina: null as string | null, layout: false }));
const MENSAGEM_INTERNA = 'falha simulada: detalhe interno';

vi.mock('../src/paginas/PaginaProvisoria', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/paginas/PaginaProvisoria')>();
  function PaginaQuePodeFalhar(props: ComponentProps<typeof original.PaginaProvisoria>) {
    if (props.titulo === falhas.pagina) throw new Error(MENSAGEM_INTERNA);
    return <original.PaginaProvisoria {...props} />;
  }
  return { ...original, PaginaProvisoria: PaginaQuePodeFalhar };
});

vi.mock('../src/tema/AlternarTema', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/tema/AlternarTema')>();
  function AlternarTemaQuePodeFalhar() {
    if (falhas.layout) throw new Error(MENSAGEM_INTERNA);
    return <original.AlternarTema />;
  }
  return { ...original, AlternarTema: AlternarTemaQuePodeFalhar };
});

const TITULO_DO_ERRO = 'Algo deu errado';

describe('erro ao renderizar uma rota (errorElement)', () => {
  let erroNoConsole: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    simularPreferenciaDoSistema(false);
    // React e React Router registram o erro capturado no console; o teste afirma isso abaixo.
    erroNoConsole = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    falhas.pagina = null;
    falhas.layout = false;
  });

  it('falha numa página: mostra o erro em pt-BR dentro do layout', async () => {
    falhas.pagina = 'Carteira';
    renderizarApp('/carteira');

    const titulo = await screen.findByRole('heading', { level: 1, name: TITULO_DO_ERRO });
    const conteudo = screen.getByRole('main');
    expect(conteudo).toContainElement(titulo);
    expect(screen.getByRole('alert')).toContainElement(titulo);
    expect(within(conteudo).getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(`${TITULO_DO_ERRO} · Casa de Leilões`));
  });

  it('não mostra a tela padrão do React Router nem a mensagem interna do erro', async () => {
    falhas.pagina = 'Carteira';
    renderizarApp('/carteira');
    await screen.findByRole('heading', { level: 1, name: TITULO_DO_ERRO });

    expect(screen.queryByText(/Unexpected Application Error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(MENSAGEM_INTERNA))).not.toBeInTheDocument();
    // O erro não é engolido: continua registrado no console para depuração.
    expect(erroNoConsole).toHaveBeenCalled();
  });

  it('"Voltar à vitrine" sai do erro e leva o foco ao <main>', async () => {
    falhas.pagina = 'Carteira';
    const usuario = userEvent.setup();
    renderizarApp('/carteira');
    await screen.findByRole('heading', { level: 1, name: TITULO_DO_ERRO });

    await usuario.click(screen.getByRole('link', { name: 'Voltar à vitrine' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Vitrine' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('falha no próprio layout: a rota raiz mostra o erro com <main> e rodapé', async () => {
    falhas.layout = true;
    renderizarApp('/');

    const titulo = await screen.findByRole('heading', { level: 1, name: TITULO_DO_ERRO });
    expect(screen.getByRole('main')).toContainElement(titulo);
    expect(screen.getByRole('alert')).toContainElement(titulo);
    expect(screen.getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/i)).not.toBeInTheDocument();
  });

  it.each([
    ['numa página', () => (falhas.pagina = 'Vitrine')],
    ['no layout', () => (falhas.layout = true)],
  ])('a página de erro (%s) não tem violações sérias do axe', async (_onde, falhar) => {
    falhar();
    renderizarApp('/');
    await screen.findByRole('heading', { level: 1, name: TITULO_DO_ERRO });

    expect(await violacoesSerias()).toEqual([]);
  });
});
