import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { numeroDe } from '../../src/sala/FormularioDeLance';
import { violacoesSerias } from '../apoio/axe';
import { abrir, criarEstado, entradas, expirar, ID, lanceAceito } from '../apoio/salaApoio';
import {
  envelopeDeErro,
  ORIGEM,
  servidor,
  usuarioLeiloeiro,
  usuarioLicitante,
} from '../apoio/servidor';
import { SocketFalso } from '../apoio/socketFalso';

const URL_LANCE = `${ORIGEM}/api/lotes/${ID}/lances`;

interface Capturada {
  corpo: unknown;
  chave: string | null;
}

/** Responde ao lance com `resposta` e guarda cada requisição recebida. */
function servirLance(resposta: () => Response | Promise<Response>) {
  const recebidas: Capturada[] = [];
  servidor.use(
    http.post(URL_LANCE, async ({ request }) => {
      recebidas.push({
        corpo: await request.json(),
        chave: request.headers.get('Idempotency-Key'),
      });
      return resposta();
    }),
  );
  return recebidas;
}

function sucesso(valorCentavos: number): Response {
  return HttpResponse.json(
    {
      sucesso: true,
      dados: {
        lance: { seq: 4, pseudonimo: 'Gato-1', valorCentavos, criadoEm: '2026-10-25T12:00:00Z' },
        lote: {},
      },
    },
    { status: 201 },
  );
}

async function abrirComoLicitante(estado = criarEstado(), socket = new SocketFalso()) {
  const sala = await abrir(estado, socket, ID, usuarioLicitante);
  await screen.findByRole('button', { name: 'Dar lance' });
  return sala;
}

/** O alerta do formulário (a sala tem outro `role="alert"`, sempre montado, para "superado"). */
const alertaDoFormulario = () =>
  within(screen.getByRole('form', { name: 'Dar lance' })).findByRole('alert');

const campo = () => screen.getByLabelText('Valor do lance (R$)') as HTMLInputElement;

describe('formulário de lance: visibilidade', () => {
  it('licitante vê o campo pré-preenchido com o mínimo e o botão de lance mínimo', async () => {
    await abrirComoLicitante();

    // atual 1.234,56 + incremento 5,00
    expect(campo().value).toBe('1239,56');
    expect(screen.getByText(/^Lance mínimo: R\$\s1\.239,56$/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Dar lance mínimo \(R\$\s1\.239,56\)$/ }),
    ).toBeInTheDocument();
  });

  it('sem lances o mínimo é o lance inicial', async () => {
    await abrirComoLicitante(
      criarEstado({ lanceAtualCentavos: null, totalLances: 0 }, { ultimosLances: [] }),
    );

    expect(campo().value).toBe('100,00');
  });

  it('anônimo vê o aviso com link para entrar e nenhum formulário', async () => {
    await abrir();

    expect(await screen.findByText(/Entre como licitante para dar lances\./)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      `/entrar?retorno=${encodeURIComponent(`/lotes/${ID}`)}`,
    );
    expect(screen.queryByLabelText('Valor do lance (R$)')).not.toBeInTheDocument();
  });

  it('leiloeiro vê o aviso e nenhum formulário', async () => {
    await abrir(criarEstado(), new SocketFalso(), ID, usuarioLeiloeiro);

    expect(await screen.findByText('Leiloeiros não podem dar lances.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Valor do lance (R$)')).not.toBeInTheDocument();
  });

  it('lote encerrado não mostra formulário', async () => {
    await abrir(
      criarEstado({ status: 'encerrado', valorArremateCentavos: 1 }),
      new SocketFalso(),
      ID,
      usuarioLicitante,
    );

    expect(await screen.findByText('Este lote foi encerrado.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Valor do lance (R$)')).not.toBeInTheDocument();
  });
});

describe('formulário de lance: envio', () => {
  it('envia o valor digitado em centavos inteiros e confirma sem alterar a sala', async () => {
    const recebidas = servirLance(() => sucesso(150_000));
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.clear(campo());
    await user.type(campo(), '1.500,00');
    await user.click(screen.getByRole('button', { name: 'Dar lance' }));

    expect(await screen.findByText(/^Lance de R\$\s1\.500,00 registrado\.$/)).toBeInTheDocument();
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]?.corpo).toEqual({ valorCentavos: 150_000 });
    expect(recebidas[0]?.chave).toMatch(/^[0-9a-f-]{36}$/);
    // A resposta não é fonte da verdade: o lance atual só muda pelo evento do socket.
    expect(screen.getByText(/^Lance atual: R\$\s1\.234,56$/)).toBeInTheDocument();
  });

  it('o botão de lance mínimo envia o mínimo sem digitar', async () => {
    const recebidas = servirLance(() => sucesso(123_956));
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: /^Dar lance mínimo/ }));

    await screen.findByText(/^Lance de R\$\s1\.239,56 registrado\.$/);
    expect(recebidas[0]?.corpo).toEqual({ valorCentavos: 123_956 });
  });

  it('valor mal formado não envia e mostra o erro associado ao campo, com foco', async () => {
    const recebidas = servirLance(() => sucesso(1));
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.clear(campo());
    await user.type(campo(), '12,345');
    await user.click(screen.getByRole('button', { name: 'Dar lance' }));

    const alerta = await alertaDoFormulario();
    expect(alerta).toHaveTextContent('Informe um valor em reais, como 150,00.');
    expect(campo()).toHaveAttribute('aria-describedby', expect.stringContaining(alerta.id));
    expect(campo()).toHaveFocus();
    expect(recebidas).toHaveLength(0);
  });

  it('dois submits no mesmo tick geram uma única requisição', async () => {
    const recebidas = servirLance(() => sucesso(123_956));
    await abrirComoLicitante();

    const formulario = screen.getByRole('form', { name: 'Dar lance' });
    act(() => {
      fireEvent.submit(formulario);
      fireEvent.submit(formulario);
    });

    await screen.findByText(/registrado\./);
    expect(recebidas).toHaveLength(1);
  });

  it('enquanto envia, os botões ficam desabilitados e o principal mostra "Enviando…"', async () => {
    let liberar: () => void = () => undefined;
    servirLance(
      () =>
        new Promise<Response>((resolver) => {
          liberar = () => resolver(sucesso(123_956));
        }),
    );
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));

    expect(await screen.findByRole('button', { name: 'Enviando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Dar lance mínimo/ })).toBeDisabled();
    act(() => liberar());
    await screen.findByText(/registrado\./);
  });

  it('atualiza o campo para o novo mínimo a cada lance_aceito, sem apagar o que foi editado', async () => {
    const user = userEvent.setup();
    const { socket } = await abrirComoLicitante();

    act(() => socket.receber('lance_aceito', lanceAceito({ valorCentavos: 130_000 })));
    await waitFor(() => expect(campo().value).toBe('1305,00'));

    await user.clear(campo());
    await user.type(campo(), '2000,00');
    act(() =>
      socket.receber(
        'lance_aceito',
        lanceAceito({ seq: 5, valorCentavos: 140_000, totalLances: 5 }),
      ),
    );
    await screen.findByText(/^Lance atual: R\$\s1\.400,00$/);
    expect(campo().value).toBe('2000,00');
  });
});

describe('formulário de lance: idempotência', () => {
  it('reenvio da mesma tentativa depois de falha sem resposta reaproveita a Idempotency-Key', async () => {
    let falhar = true;
    const recebidas = servirLance(() =>
      falhar ? envelopeDeErro('INDISPONIVEL', 503) : sucesso(123_956),
    );
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));
    expect(
      await screen.findByText('O serviço está indisponível agora. Tente de novo em instantes.'),
    ).toBeInTheDocument();

    falhar = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText(/registrado\./);

    expect(recebidas).toHaveLength(2);
    expect(recebidas[1]?.chave).toBe(recebidas[0]?.chave);
  });

  it('depois de uma recusa definitiva a chave é descartada', async () => {
    const recebidas = servirLance(() =>
      envelopeDeErro('LANCE_ABAIXO_DO_MINIMO', 422, {}, { minimoCentavos: 124_000 }),
    );
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));
    await alertaDoFormulario();
    await user.click(screen.getByRole('button', { name: 'Dar lance' }));
    await waitFor(() => expect(recebidas).toHaveLength(2));

    expect(recebidas[1]?.chave).not.toBe(recebidas[0]?.chave);
  });

  it('valor diferente depois de falha usa chave nova', async () => {
    const recebidas = servirLance(() => envelopeDeErro('INDISPONIVEL', 503));
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));
    await alertaDoFormulario();
    await user.clear(campo());
    await user.type(campo(), '2000,00');
    await user.click(screen.getByRole('button', { name: /^(Dar lance|Tentar de novo)$/ }));
    await waitFor(() => expect(recebidas).toHaveLength(2));

    expect(recebidas[1]?.chave).not.toBe(recebidas[0]?.chave);
  });
});

describe('formulário de lance: recusas', () => {
  async function recusar(
    codigo: Parameters<typeof envelopeDeErro>[0],
    status: number,
    cabecalhos: Record<string, string> = {},
    detalhes?: Record<string, unknown>,
  ) {
    servirLance(() => envelopeDeErro(codigo, status, cabecalhos, detalhes));
    const user = userEvent.setup();
    const sala = await abrirComoLicitante();
    await user.click(screen.getByRole('button', { name: 'Dar lance' }));
    const alerta = await alertaDoFormulario();
    return { alerta, sala };
  }

  it('LANCE_ABAIXO_DO_MINIMO mostra o mínimo e preenche o campo com ele', async () => {
    const { alerta } = await recusar(
      'LANCE_ABAIXO_DO_MINIMO',
      422,
      {},
      { minimoCentavos: 125_000 },
    );

    expect(alerta.textContent).toMatch(/^Seu lance precisa ser de pelo menos R\$\s1\.250,00\.$/);
    await waitFor(() => expect(campo().value).toBe('1250,00'));
    expect(campo()).toHaveFocus();
    expect(campo()).toHaveAttribute('aria-describedby', expect.stringContaining(alerta.id));
  });

  it('SALDO_INSUFICIENTE mostra o disponível e o link para a carteira', async () => {
    const { alerta } = await recusar('SALDO_INSUFICIENTE', 422, {}, { disponivelCentavos: 5_000 });

    expect(alerta.textContent).toMatch(
      /^Saldo disponível insuficiente: você tem R\$\s50,00\. Ir para a carteira$/,
    );
    expect(screen.getByRole('link', { name: 'Ir para a carteira' })).toHaveAttribute(
      'href',
      '/carteira',
    );
    expect(campo()).toHaveFocus();
  });

  it('JA_ESTA_GANHANDO', async () => {
    const { alerta } = await recusar('JA_ESTA_GANHANDO', 422);
    expect(alerta).toHaveTextContent('Você já está ganhando este lote.');
  });

  it('LEILOEIRO_NAO_PODE_LANCAR', async () => {
    const { alerta } = await recusar('LEILOEIRO_NAO_PODE_LANCAR', 403);
    expect(alerta).toHaveTextContent('Leiloeiros não podem dar lances.');
  });

  it('LOTE_ENCERRADO mostra a mensagem e refaz o entrar_lote', async () => {
    const socket = new SocketFalso();
    servirLance(() => envelopeDeErro('LOTE_ENCERRADO', 409));
    const user = userEvent.setup();
    await abrirComoLicitante(criarEstado(), socket);
    expect(entradas(socket)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));

    expect(await screen.findByText('Este lote já foi encerrado.')).toBeInTheDocument();
    await waitFor(() => expect(entradas(socket)).toHaveLength(2));
  });

  it('LOTE_NAO_INICIADO mostra a data de início e refaz o entrar_lote', async () => {
    const socket = new SocketFalso();
    servirLance(() => envelopeDeErro('LOTE_NAO_INICIADO', 409));
    const user = userEvent.setup();
    await abrirComoLicitante(criarEstado(), socket);

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));

    expect(await screen.findByText(/^Este lote ainda não começou\. Abre em /)).toBeInTheDocument();
    await waitFor(() => expect(entradas(socket)).toHaveLength(2));
  });

  it('MUITAS_TENTATIVAS mostra os segundos do Retry-After', async () => {
    const { alerta } = await recusar('MUITAS_TENTATIVAS', 429, { 'Retry-After': '1' });
    expect(alerta).toHaveTextContent('Muitas tentativas. Tente de novo em 1 s.');
  });

  it('DADOS_INVALIDOS e falha de rede usam os textos gerais', async () => {
    const { alerta } = await recusar('DADOS_INVALIDOS', 422);
    expect(alerta).toHaveTextContent('Confira os campos destacados.');
  });

  it('falha de rede mostra o texto de indisponível', async () => {
    servirLance(() => HttpResponse.error());
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));

    expect(await alertaDoFormulario()).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
  });
});

describe('formulário de lance: robustez', () => {
  it('durante "Reconectando…" o campo e os botões ficam desabilitados e nada é enviado', async () => {
    const recebidas = servirLance(() => sucesso(123_956));
    const { socket } = await abrirComoLicitante();

    act(() => socket.receber('connect'));
    expirar(socket);
    await screen.findByText('Reconectando…');

    expect(campo()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dar lance' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Dar lance mínimo/ })).toBeDisabled();
    act(() => {
      fireEvent.submit(screen.getByRole('form', { name: 'Dar lance' }));
    });
    expect(recebidas).toHaveLength(0);
  });

  it('depois de um lance aceito o foco volta ao campo de valor', async () => {
    servirLance(() => sucesso(123_956));
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));
    await screen.findByText(/registrado\./);

    expect(campo()).toHaveFocus();
  });

  it('se a geração da Idempotency-Key falhar, mostra "indisponível" e o formulário segue utilizável', async () => {
    const recebidas = servirLance(() => sucesso(123_956));
    const user = userEvent.setup();
    await abrirComoLicitante();
    const gerador = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('sem crypto');
    });
    try {
      await user.click(screen.getByRole('button', { name: 'Dar lance' }));
      expect(await alertaDoFormulario()).toHaveTextContent(
        'O serviço está indisponível agora. Tente de novo em instantes.',
      );
      expect(recebidas).toHaveLength(0);
    } finally {
      gerador.mockRestore();
    }

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));
    await screen.findByText(/registrado\./);
    expect(recebidas).toHaveLength(1);
  });

  it('minimoCentavos negativo na recusa não quebra a tela', async () => {
    servirLance(() => envelopeDeErro('LANCE_ABAIXO_DO_MINIMO', 422, {}, { minimoCentavos: -5 }));
    const user = userEvent.setup();
    await abrirComoLicitante();

    await user.click(screen.getByRole('button', { name: 'Dar lance' }));

    expect(await alertaDoFormulario()).toBeInTheDocument();
    expect(campo().value).toBe('1239,56');
  });

  it('numeroDe só aceita inteiro seguro não negativo', () => {
    expect(numeroDe({ v: 0 }, 'v')).toBe(0);
    expect(numeroDe({ v: 150 }, 'v')).toBe(150);
    expect(numeroDe({ v: -1 }, 'v')).toBeUndefined();
    expect(numeroDe({ v: 1.5 }, 'v')).toBeUndefined();
    expect(numeroDe({ v: '5' }, 'v')).toBeUndefined();
    expect(numeroDe(undefined, 'v')).toBeUndefined();
  });
});

describe('formulário de lance: acessibilidade', () => {
  it.each([false, true])('sem violações sérias (tema escuro: %s)', async (escuro) => {
    if (escuro) document.documentElement.classList.add('dark');
    try {
      await abrirComoLicitante();
      expect(await violacoesSerias(document.body)).toEqual([]);
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });
});
