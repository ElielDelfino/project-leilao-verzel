import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { violacoesSerias } from '../apoio/axe';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import {
  envelopeDeErro,
  ORIGEM,
  servidor,
  usuarioLeiloeiro,
  usuarioLicitante,
} from '../apoio/servidor';

const SENHA_VALIDA = 'senha-com-10-chars';

describe('/entrar', () => {
  it('valida no cliente, foca o primeiro campo inválido e liga o erro por aria-describedby', async () => {
    simularPreferenciaDoSistema(false);
    const usuario = userEvent.setup();
    renderizarApp('/entrar');

    await usuario.click(await screen.findByRole('button', { name: 'Entrar' }));

    const email = screen.getByLabelText('E-mail');
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Informe um e-mail válido.');
    expect(screen.getByLabelText('Senha')).toHaveAccessibleDescription('Informe a senha.');
  });

  it('login válido inicia a sessão e vai ao destino do papel', async () => {
    simularPreferenciaDoSistema(false);
    let corpo: unknown;
    servidor.use(
      http.post(`${ORIGEM}/api/auth/login`, async ({ request }) => {
        corpo = await request.json();
        return HttpResponse.json({ sucesso: true, dados: { usuario: usuarioLeiloeiro } });
      }),
    );
    const usuario = userEvent.setup();
    const { router } = renderizarApp('/entrar');

    await usuario.type(await screen.findByLabelText('E-mail'), ' leo@exemplo.com ');
    await usuario.type(screen.getByLabelText('Senha'), 'x');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/painel'));
    expect(corpo).toEqual({ email: 'leo@exemplo.com', senha: 'x' });
  });

  it('CREDENCIAIS_INVALIDAS mostra a mensagem em role="alert"', async () => {
    simularPreferenciaDoSistema(false);
    servidor.use(
      http.post(`${ORIGEM}/api/auth/login`, () => envelopeDeErro('CREDENCIAIS_INVALIDAS', 401)),
    );
    const usuario = userEvent.setup();
    renderizarApp('/entrar');

    await usuario.type(await screen.findByLabelText('E-mail'), 'a@b.co');
    await usuario.type(screen.getByLabelText('Senha'), 'errada');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
  });

  it('MUITAS_TENTATIVAS mostra os segundos do Retry-After', async () => {
    simularPreferenciaDoSistema(false);
    servidor.use(
      http.post(`${ORIGEM}/api/auth/login`, () =>
        envelopeDeErro('MUITAS_TENTATIVAS', 429, { 'Retry-After': '42' }),
      ),
    );
    const usuario = userEvent.setup();
    renderizarApp('/entrar');

    await usuario.type(await screen.findByLabelText('E-mail'), 'a@b.co');
    await usuario.type(screen.getByLabelText('Senha'), 'x');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Tente de novo em 42 s.',
    );
  });

  it.each(['light', 'dark'] as const)('axe sem violações sérias no tema %s', async (tema) => {
    simularPreferenciaDoSistema(false);
    document.documentElement.dataset['theme'] = tema;
    renderizarApp('/entrar');
    await screen.findByRole('heading', { level: 1, name: 'Entrar' });

    expect(await violacoesSerias()).toEqual([]);
  });
});

describe('/cadastro', () => {
  it('valida cada campo com as mensagens de D12 e foca o primeiro inválido', async () => {
    simularPreferenciaDoSistema(false);
    const usuario = userEvent.setup();
    renderizarApp('/cadastro');

    await usuario.click(await screen.findByRole('button', { name: 'Criar conta' }));

    expect(screen.getByLabelText('Nome')).toHaveFocus();
    expect(screen.getByLabelText('Nome')).toHaveAccessibleDescription('Use de 2 a 80 caracteres.');
    expect(screen.getByLabelText('E-mail')).toHaveAccessibleDescription(
      'Informe um e-mail válido.',
    );
    expect(screen.getByLabelText('Senha')).toHaveAccessibleDescription(
      'Use de 10 a 128 caracteres.',
    );
    expect(screen.getByRole('group', { name: 'Papel' })).toHaveAccessibleDescription(
      'Escolha Licitante ou Leiloeiro.',
    );
  });

  it('senha com 9 caracteres é recusada no cliente', async () => {
    simularPreferenciaDoSistema(false);
    const usuario = userEvent.setup();
    renderizarApp('/cadastro');

    await usuario.type(await screen.findByLabelText('Nome'), 'Ana');
    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), '123456789');
    await usuario.click(screen.getByLabelText('Licitante'));
    await usuario.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(screen.getByLabelText('Senha')).toHaveFocus();
    expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true');
  });

  it('201 inicia a sessão e vai ao destino do papel', async () => {
    simularPreferenciaDoSistema(false);
    let corpo: unknown;
    servidor.use(
      http.post(`${ORIGEM}/api/auth/cadastro`, async ({ request }) => {
        corpo = await request.json();
        return HttpResponse.json(
          { sucesso: true, dados: { usuario: usuarioLicitante } },
          { status: 201 },
        );
      }),
    );
    const usuario = userEvent.setup();
    const { router } = renderizarApp('/cadastro');

    await usuario.type(await screen.findByLabelText('Nome'), 'Ana Licitante');
    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), SENHA_VALIDA);
    await usuario.click(screen.getByLabelText('Licitante'));
    await usuario.click(screen.getByRole('button', { name: 'Criar conta' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(corpo).toEqual({
      nome: 'Ana Licitante',
      email: 'ana@exemplo.com',
      senha: SENHA_VALIDA,
      papel: 'licitante',
    });
  });

  it('EMAIL_EM_USO mostra a mensagem do mapa', async () => {
    simularPreferenciaDoSistema(false);
    servidor.use(
      http.post(`${ORIGEM}/api/auth/cadastro`, () => envelopeDeErro('EMAIL_EM_USO', 409)),
    );
    const usuario = userEvent.setup();
    renderizarApp('/cadastro');

    await usuario.type(await screen.findByLabelText('Nome'), 'Ana');
    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), SENHA_VALIDA);
    await usuario.click(screen.getByLabelText('Leiloeiro'));
    await usuario.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma conta com este e-mail.',
    );
  });

  it.each(['light', 'dark'] as const)('axe sem violações sérias no tema %s', async (tema) => {
    simularPreferenciaDoSistema(false);
    document.documentElement.dataset['theme'] = tema;
    renderizarApp('/cadastro');
    await screen.findByRole('heading', { level: 1, name: 'Cadastro' });

    expect(await violacoesSerias()).toEqual([]);
  });
});
