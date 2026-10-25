import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarComTempoReal } from '../apoio/renderizarComTempoReal';
import { abrir, entradas, ID, responder, TITULO } from '../apoio/salaApoio';
import { envelopeDeErro, ORIGEM, servidor } from '../apoio/servidor';
import { SocketFalso } from '../apoio/socketFalso';

const TEXTO_INDISPONIVEL = 'O serviço está indisponível agora. Tente de novo em instantes.';

describe('detalhe do lote sem o estado da sala', () => {
  it('ack { sucesso: true } sem estado mostra título e imagem, e o erro com "Tentar de novo"', async () => {
    const { socket } = await abrir(null);

    responder(socket, { sucesso: true });

    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTO_INDISPONIVEL);
    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Carta Black Lotus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('o erro da parte ao vivo não remove o detalhe e "Tentar de novo" refaz a entrada', async () => {
    const user = userEvent.setup();
    const { socket } = await abrir(null);
    responder(socket, { sucesso: true });
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(entradas(socket).length).toBeGreaterThan(1));
    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Carta Black Lotus' })).toBeInTheDocument();
  });

  it('enquanto espera o ack mostra o detalhe e "Carregando sala…"', async () => {
    await abrir(null);

    expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando sala…');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('detalhe 404 mostra "Lote não encontrado"', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/lotes/${ID}`, () => envelopeDeErro('NAO_ENCONTRADO', 404)),
    );
    simularPreferenciaDoSistema(false);

    renderizarComTempoReal(`/lotes/${ID}`, new SocketFalso());

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lote não encontrado' }),
    ).toBeInTheDocument();
  });
});
