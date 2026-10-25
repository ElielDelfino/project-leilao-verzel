import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { abrir, lanceAceito, ID } from '../apoio/salaApoio';

const FIM_ESTENDIDO = '2026-10-25T14:07:03Z';
const AVISO = /^O fim do lote foi estendido para /;

function avisos(): HTMLElement[] {
  return screen.queryAllByRole('status').filter((el) => AVISO.test(el.textContent ?? ''));
}

describe('sala ao vivo: selo e aviso de fim estendido', () => {
  it('lance_aceito seguido de fim_estendido mostra o selo e o aviso role="status"', async () => {
    const { socket } = await abrir();
    expect(screen.queryByText(/Fim estendido/)).not.toBeInTheDocument();

    act(() => socket.receber('lance_aceito', lanceAceito({ fimEm: FIM_ESTENDIDO })));
    expect(screen.queryByText(/Fim estendido/)).not.toBeInTheDocument();

    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: FIM_ESTENDIDO }));

    expect(screen.getByText(/Fim estendido/)).toBeInTheDocument();
    expect(avisos()).toHaveLength(1);
    // `role="alert"` é só a região assertive (vazia); o aviso de fim não vai para ela.
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('fim_estendido antes do lance_aceito também mostra o selo e o aviso', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: FIM_ESTENDIDO }));
    act(() => socket.receber('lance_aceito', lanceAceito({ fimEm: FIM_ESTENDIDO })));

    expect(screen.getByText(/Fim estendido/)).toBeInTheDocument();
    expect(avisos()).toHaveLength(1);
  });

  it('o mesmo fim_estendido repetido não duplica o selo nem o aviso', async () => {
    const { socket } = await abrir();
    act(() => socket.receber('lance_aceito', lanceAceito({ fimEm: FIM_ESTENDIDO })));
    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: FIM_ESTENDIDO }));
    const aviso = avisos()[0];

    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: FIM_ESTENDIDO }));

    expect(screen.getAllByText(/Fim estendido/)).toHaveLength(1);
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toBe(aviso);
  });
});
