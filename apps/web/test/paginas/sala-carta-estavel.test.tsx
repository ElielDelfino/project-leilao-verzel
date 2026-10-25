import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { abrir, criarEstado, responder, TITULO } from '../apoio/salaApoio';

describe('carta do detalhe do lote ao receber o estado da sala', () => {
  it('mantém a mesma <img> montada quando o estado chega pelo ack', async () => {
    const { socket } = await abrir(null);
    const antes = await screen.findByRole('img', { name: 'Carta Black Lotus' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    responder(socket, { sucesso: true, estado: criarEstado() });
    await screen.findByText('Lance atual: R$ 1.234,56');

    const depois = screen.getByRole('img', { name: 'Carta Black Lotus' });
    expect(depois).toBe(antes);
    expect(antes).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
  });
});
