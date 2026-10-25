import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Comprovante } from '../../src/api/comprovantes';
import { urlDoComprovante } from '../../src/comprovante/links';
import { violacoesSerias } from '../apoio/axe';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { envelopeDeErro, ORIGEM, servidor } from '../apoio/servidor';

const CODIGO = 'aB3dE5gH7jK9mN1p';
const LOTE_ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const SNAPSHOT_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const HASH = 'ab'.repeat(32);

const COMPROVANTE: Comprovante = {
  codigo: CODIGO,
  vencedorPseudonimo: 'Licitante-7F3K',
  valorCentavos: 123456,
  carta: { nome: 'Black Lotus', imagemUrl: `/api/imagens/${SNAPSHOT_ID}` },
  hashFinal: HASH,
  assinaturaSelo: 'c2lnbmF0dXJl',
  keyId: 'chave-2026-10',
  seladoEm: '2026-10-24T13:00:00.000Z',
  emitidoEm: '2026-10-24T13:00:01.000Z',
  auditoriaUrl: `/auditoria/${LOTE_ID}`,
};

function servir(dados: Comprovante = COMPROVANTE) {
  return http.get(`${ORIGEM}/api/comprovantes/:codigo`, () =>
    HttpResponse.json({ sucesso: true, dados }),
  );
}

function abrir(escuro = false, codigo = CODIGO) {
  simularPreferenciaDoSistema(escuro);
  return renderizarApp(`/comprovantes/${codigo}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/comprovantes/:codigo', () => {
  it('carregando: mostra o estado e o único h1', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/comprovantes/:codigo`, () => new Promise<Response>(() => undefined)),
    );
    abrir();

    expect(await screen.findByText('Carregando comprovante…')).toHaveAttribute('role', 'status');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe('Comprovante de arremate · Casa de Leilões'));
  });

  it('mostra todos os campos, a imagem por /api/imagens e o link da auditoria', async () => {
    servidor.use(servir());
    abrir();

    await screen.findByText('Black Lotus', { selector: 'dd' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Comprovante de arremate' }),
    ).toBeInTheDocument();
    const dados = {
      Carta: 'Black Lotus',
      'Valor do arremate': 'R$ 1.234,56',
      'Arrematado por': 'Licitante-7F3K',
      'Selado em': '24/10/2026, 10:00',
      'Emitido em': '24/10/2026, 10:00',
      'Hash final': HASH,
      'Assinatura do selo': 'c2lnbmF0dXJl',
      'Chave de assinatura': 'chave-2026-10',
    };
    for (const [rotulo, valor] of Object.entries(dados)) {
      const termo = screen.getByText(rotulo, { selector: 'dt' });
      expect(termo.nextElementSibling).toHaveTextContent(valor);
    }

    const imagens = screen.getAllByRole('img');
    expect(imagens).toHaveLength(1);
    expect(imagens[0]).toHaveAttribute('src', `/api/imagens/${SNAPSHOT_ID}`);
    expect(imagens[0]).toHaveAccessibleName('Carta Black Lotus');
    expect(screen.getByRole('link', { name: 'Ver auditoria' })).toHaveAttribute(
      'href',
      `/auditoria/${LOTE_ID}`,
    );
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(document.title).toBe('Comprovante de arremate · Casa de Leilões');
  });

  it('URLs do servidor fora do formato não viram imagem nem link', async () => {
    servidor.use(
      servir({
        ...COMPROVANTE,
        carta: { nome: 'Black Lotus', imagemUrl: 'https://cards.scryfall.io/x.jpg' },
        auditoriaUrl: 'https://outro.site/auditoria/x',
      }),
    );
    abrir();

    await screen.findByText('Black Lotus', { selector: 'dd' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Sem imagem')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver auditoria' })).not.toBeInTheDocument();
  });

  it('"Copiar link" copia a URL montada pela SPA e confirma', async () => {
    servidor.use(servir());
    const usuario = userEvent.setup();
    abrir();
    await screen.findByText('Black Lotus', { selector: 'dd' });
    // O userEvent instala o seu clipboard falso em `setup()`; espiona depois dele.
    const gravar = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await usuario.click(screen.getByRole('button', { name: 'Copiar link' }));

    expect(await screen.findByText('Link copiado.')).toBeInTheDocument();
    expect(gravar).toHaveBeenCalledWith(urlDoComprovante(CODIGO));
    expect(gravar).toHaveBeenCalledWith(`${window.location.origin}/comprovantes/${CODIGO}`);
    expect(screen.queryByLabelText('Link do comprovante')).not.toBeInTheDocument();
  });

  it('área de transferência recusada: campo somente leitura com a URL selecionada', async () => {
    servidor.use(servir());
    const usuario = userEvent.setup();
    abrir();
    await screen.findByText('Black Lotus', { selector: 'dd' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('recusado'));

    await usuario.click(screen.getByRole('button', { name: 'Copiar link' }));

    expect(
      await screen.findByText('Não foi possível copiar automaticamente. Copie o link abaixo.'),
    ).toBeInTheDocument();
    const campo = screen.getByLabelText('Link do comprovante');
    expect(campo).toHaveAttribute('readonly');
    expect(campo).toHaveValue(urlDoComprovante(CODIGO));
    await waitFor(() => expect(campo).toHaveFocus());
    expect(screen.queryByText('Link copiado.')).not.toBeInTheDocument();
  });

  it('área de transferência indisponível cai no mesmo campo', async () => {
    servidor.use(servir());
    const usuario = userEvent.setup();
    abrir();
    await screen.findByText('Black Lotus', { selector: 'dd' });
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    await usuario.click(screen.getByRole('button', { name: 'Copiar link' }));

    expect(await screen.findByLabelText('Link do comprovante')).toHaveValue(
      urlDoComprovante(CODIGO),
    );
  });

  it.each([
    ['código inexistente', CODIGO],
    ['código malformado', 'curto!'],
  ])('404 (%s): a mesma tela, sem pista do motivo', async (_nome, codigo) => {
    servidor.use(
      http.get(`${ORIGEM}/api/comprovantes/:codigo`, () => envelopeDeErro('NAO_ENCONTRADO', 404)),
    );
    abrir(false, codigo);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Comprovante não encontrado' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Confira o link: o código do comprovante não existe ou está incorreto.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute('href', '/');
    expect(document.title).toBe('Comprovante não encontrado · Casa de Leilões');
  });

  it('falha: mostra a mensagem do código e "Tentar de novo" refaz a consulta', async () => {
    let chamadas = 0;
    servidor.use(
      http.get(`${ORIGEM}/api/comprovantes/:codigo`, () => {
        chamadas += 1;
        return chamadas === 1
          ? envelopeDeErro('INDISPONIVEL', 503)
          : HttpResponse.json({ sucesso: true, dados: COMPROVANTE });
      }),
    );
    abrir();

    expect(
      await screen.findByText('O serviço está indisponível agora. Tente de novo em instantes.'),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Black Lotus', { selector: 'dd' })).toBeInTheDocument();
    expect(chamadas).toBe(2);
  });

  it.each([false, true])('axe sem violações sérias (tema escuro: %s)', async (escuro) => {
    servidor.use(servir());
    abrir(escuro);
    await screen.findByText('Black Lotus', { selector: 'dd' });

    expect(await violacoesSerias()).toEqual([]);
  });
});
