import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { SchemasApi } from '@leilao/contracts';

import { violacoesSerias } from '../apoio/axe';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { envelopeDeErro, ORIGEM, servidor, usuarioLicitante } from '../apoio/servidor';

const saldoInicial = {
  totalCentavos: 150_000,
  comprometidoCentavos: 40_000,
  disponivelCentavos: 110_000,
} satisfies SchemasApi['Saldo'];

const lancamentos = [
  {
    id: '0192f3a0-0000-7000-8000-0000000000a1',
    tipo: 'deposito',
    valorCentavos: 123_456,
    loteId: null,
    criadoEm: '2026-10-24T13:00:00Z',
  },
  {
    id: '0192f3a0-0000-7000-8000-0000000000a2',
    tipo: 'estorno',
    valorCentavos: 5_000,
    loteId: '0192f3a0-0000-7000-8000-0000000000b1',
    criadoEm: '2026-10-25T02:30:00Z',
  },
] satisfies SchemasApi['Lancamento'][];

function servirCarteira(saldo: SchemasApi['Saldo'] = saldoInicial, total = 2) {
  const paginasPedidas: string[] = [];
  servidor.use(
    http.get(`${ORIGEM}/api/carteira`, () => HttpResponse.json({ sucesso: true, dados: saldo })),
    http.get(`${ORIGEM}/api/carteira/extrato`, ({ request }) => {
      const pagina = new URL(request.url).searchParams.get('pagina') ?? '';
      paginasPedidas.push(pagina);
      return HttpResponse.json({
        sucesso: true,
        dados: lancamentos,
        meta: { total, pagina: Number(pagina) || 1, limite: 20 },
      });
    }),
  );
  return paginasPedidas;
}

const abrir = (url = '/carteira') => renderizarApp(url, { sessao: usuarioLicitante });

describe('/carteira', () => {
  it('mostra total, comprometido e disponível formatados', async () => {
    simularPreferenciaDoSistema(false);
    servirCarteira();
    abrir();

    expect(await screen.findByText('R$ 1.500,00')).toBeVisible();
    expect(screen.getByText('R$ 400,00')).toBeVisible();
    expect(screen.getByText('R$ 1.100,00')).toBeVisible();
  });

  it('extrato com rótulos de D12, datas em America/Sao_Paulo e página da URL', async () => {
    simularPreferenciaDoSistema(false);
    const paginas = servirCarteira(saldoInicial, 45);
    abrir('/carteira?pagina=2');

    const tabela = await screen.findByRole('table', { name: 'Lançamentos da carteira' });
    expect(within(tabela).getByText('Depósito')).toBeVisible();
    expect(within(tabela).getByText('Estorno de lote cancelado')).toBeVisible();
    expect(within(tabela).getByText('24/10/2026, 10:00')).toBeVisible();
    expect(within(tabela).getByText('24/10/2026, 23:30')).toBeVisible();
    expect(paginas).toContain('2');
    expect(screen.getByText('Página 2 de 3')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Anterior' })).toHaveAttribute(
      'href',
      '/carteira?pagina=1',
    );
    expect(screen.getByRole('link', { name: 'Próxima' })).toHaveAttribute(
      'href',
      '/carteira?pagina=3',
    );
  });

  it('extrato mostra se o dinheiro entra ou sai, pelo sinal + ou − e pela cor, sem selo', async () => {
    simularPreferenciaDoSistema(false);
    servirCarteira();
    abrir();

    const tabela = await screen.findByRole('table', { name: 'Lançamentos da carteira' });
    const [deposito, estorno] = within(tabela).getAllByRole('row').slice(1) as [
      HTMLElement,
      HTMLElement,
    ];
    expect(within(deposito).getByText('+ R$ 1.234,56')).toBeVisible();
    expect(within(deposito).queryByText('Entrada')).toBeNull();
    expect(within(estorno).getByText('+ R$ 50,00')).toBeVisible();
    expect(within(estorno).queryByText('Devolvido')).toBeNull();
  });

  it.each(['abc', '0', '-1', '1.5'])('?pagina=%s cai na página 1', async (valor) => {
    simularPreferenciaDoSistema(false);
    const paginas = servirCarteira();
    abrir(`/carteira?pagina=${valor}`);

    await screen.findByRole('table');
    expect(paginas).toEqual(['1']);
  });

  it.each(['0,99', '100.000,01', 'abc', ''])(
    'depósito inválido %j não chama a API',
    async (digitado) => {
      simularPreferenciaDoSistema(false);
      servirCarteira();
      let chamadas = 0;
      servidor.use(
        http.post(`${ORIGEM}/api/carteira/depositos`, () => {
          chamadas += 1;
          return new HttpResponse(null, { status: 500 });
        }),
      );
      const usuario = userEvent.setup();
      abrir();

      const campo = await screen.findByLabelText('Valor do depósito (R$)');
      if (digitado) await usuario.type(campo, digitado);
      await usuario.click(screen.getByRole('button', { name: 'Depositar' }));

      expect(campo).toHaveFocus();
      expect(campo).toHaveAttribute('aria-invalid', 'true');
      expect(campo).toHaveAccessibleDescription(
        /Informe um valor entre R\$ 1,00 e R\$ 100\.000,00\./,
      );
      expect(chamadas).toBe(0);
    },
  );

  it('depósito válido envia centavos, atualiza saldo e extrato e confirma', async () => {
    simularPreferenciaDoSistema(false);
    let saldoAtual: SchemasApi['Saldo'] = saldoInicial;
    let corpo: unknown;
    let chave: string | null = null;
    servirCarteira();
    servidor.use(
      http.get(`${ORIGEM}/api/carteira`, () =>
        HttpResponse.json({ sucesso: true, dados: saldoAtual }),
      ),
      http.post(`${ORIGEM}/api/carteira/depositos`, async ({ request }) => {
        corpo = await request.json();
        chave = request.headers.get('Idempotency-Key');
        saldoAtual = { ...saldoInicial, totalCentavos: 151_050, disponivelCentavos: 111_050 };
        return HttpResponse.json(
          {
            sucesso: true,
            dados: { lancamento: { ...lancamentos[0], valorCentavos: 1_050 }, saldo: saldoAtual },
          },
          { status: 201 },
        );
      }),
    );
    const usuario = userEvent.setup();
    abrir();

    await usuario.type(await screen.findByLabelText('Valor do depósito (R$)'), '10,5');
    await usuario.click(screen.getByRole('button', { name: 'Depositar' }));

    expect(await screen.findByText('Depósito de R$ 10,50 registrado.')).toBeVisible();
    expect(await screen.findByText('R$ 1.510,50')).toBeVisible();
    expect(corpo).toEqual({ valorCentavos: 1050 });
    expect(chave).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('"Tentar de novo" após falha de rede reusa a Idempotency-Key; editar o valor gera outra', async () => {
    simularPreferenciaDoSistema(false);
    servirCarteira();
    const chaves: Array<string | null> = [];
    let tentativa = 0;
    servidor.use(
      http.post(`${ORIGEM}/api/carteira/depositos`, ({ request }) => {
        chaves.push(request.headers.get('Idempotency-Key'));
        tentativa += 1;
        if (tentativa <= 2) return HttpResponse.error();
        return envelopeDeErro('DADOS_INVALIDOS', 422);
      }),
    );
    const usuario = userEvent.setup();
    abrir();

    const campo = await screen.findByLabelText('Valor do depósito (R$)');
    await usuario.type(campo, '5');
    await usuario.click(screen.getByRole('button', { name: 'Depositar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );

    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(chaves).toHaveLength(2));
    expect(chaves[1]).toBe(chaves[0]);

    await usuario.type(campo, '0');
    await usuario.click(await screen.findByRole('button', { name: 'Depositar' }));
    await waitFor(() => expect(chaves).toHaveLength(3));
    expect(chaves[2]).not.toBe(chaves[0]);
  });

  it('PAPEL_NAO_PERMITIDO do servidor usa a mensagem do mapa', async () => {
    simularPreferenciaDoSistema(false);
    servirCarteira();
    servidor.use(
      http.post(`${ORIGEM}/api/carteira/depositos`, () =>
        envelopeDeErro('PAPEL_NAO_PERMITIDO', 403),
      ),
    );
    const usuario = userEvent.setup();
    abrir();

    await usuario.type(await screen.findByLabelText('Valor do depósito (R$)'), '1');
    await usuario.click(screen.getByRole('button', { name: 'Depositar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sua conta não tem permissão para esta ação.',
    );
  });

  it('com depósito em voo, campo e botão ficam desabilitados e editar não gera outra chave nem outro POST', async () => {
    simularPreferenciaDoSistema(false);
    servirCarteira();
    const chaves: Array<string | null> = [];
    let liberar: () => void = () => undefined;
    const portao = new Promise<void>((resolver) => (liberar = resolver));
    servidor.use(
      http.post(`${ORIGEM}/api/carteira/depositos`, async ({ request }) => {
        chaves.push(request.headers.get('Idempotency-Key'));
        await portao;
        return HttpResponse.json(
          {
            sucesso: true,
            dados: { lancamento: { ...lancamentos[0], valorCentavos: 500 }, saldo: saldoInicial },
          },
          { status: 201 },
        );
      }),
    );
    const usuario = userEvent.setup();
    abrir();

    const campo = await screen.findByLabelText('Valor do depósito (R$)');
    await usuario.type(campo, '5');
    await usuario.click(screen.getByRole('button', { name: 'Depositar' }));

    await waitFor(() => expect(campo).toBeDisabled());
    const botao = screen.getByRole('button', { name: 'Depositando…' });
    expect(botao).toBeDisabled();
    await usuario.type(campo, '9');
    await usuario.click(botao);
    expect(campo).toHaveValue('5');
    expect(chaves).toHaveLength(1);

    liberar();
    expect(await screen.findByText('Depósito de R$ 5,00 registrado.')).toBeVisible();
    expect(chaves).toHaveLength(1);
  });

  it('2xx com corpo que não é o envelope é resultado incerto: mantém a chave e oferece "Tentar de novo"', async () => {
    simularPreferenciaDoSistema(false);
    servirCarteira();
    const chaves: Array<string | null> = [];
    servidor.use(
      http.post(`${ORIGEM}/api/carteira/depositos`, ({ request }) => {
        chaves.push(request.headers.get('Idempotency-Key'));
        return new HttpResponse('<html>proxy</html>', { status: 200 });
      }),
    );
    const usuario = userEvent.setup();
    abrir();

    await usuario.type(await screen.findByLabelText('Valor do depósito (R$)'), '5');
    await usuario.click(screen.getByRole('button', { name: 'Depositar' }));
    await usuario.click(await screen.findByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(chaves).toHaveLength(2));
    expect(chaves[1]).toBe(chaves[0]);
  });

  it('o role="status" do sucesso fica sempre montado; só o texto muda', async () => {
    simularPreferenciaDoSistema(false);
    servirCarteira();
    servidor.use(
      http.post(`${ORIGEM}/api/carteira/depositos`, () =>
        HttpResponse.json(
          {
            sucesso: true,
            dados: { lancamento: { ...lancamentos[0], valorCentavos: 500 }, saldo: saldoInicial },
          },
          { status: 201 },
        ),
      ),
    );
    const usuario = userEvent.setup();
    abrir();

    await usuario.type(await screen.findByLabelText('Valor do depósito (R$)'), '5');
    await screen.findByRole('table');
    const regiao = screen.getByRole('status');
    expect(regiao).toBeEmptyDOMElement();

    await usuario.click(screen.getByRole('button', { name: 'Depositar' }));
    await waitFor(() => expect(regiao).toHaveTextContent('Depósito de R$ 5,00 registrado.'));
    expect(screen.getByRole('status')).toBe(regiao);
  });

  it.each(['light', 'dark'] as const)('axe sem violações sérias no tema %s', async (tema) => {
    simularPreferenciaDoSistema(false);
    document.documentElement.dataset['theme'] = tema;
    servirCarteira();
    abrir();
    await screen.findByRole('table');

    expect(await violacoesSerias()).toEqual([]);
  });
});
