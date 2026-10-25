import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { ErroDaApi } from '../../src/api/erro';
import { ouvirSessaoExpirada, requisitar } from '../../src/api/cliente';
import {
  definirCookie,
  envelopeDeErro,
  handlerDeCsrf,
  lerCookie,
  ORIGEM,
  servidor,
} from '../apoio/servidor';

const ok = () => HttpResponse.json({ sucesso: true, dados: { ok: true } });

describe('CSRF', () => {
  it('sem o cookie, o primeiro POST chama /api/auth/csrf uma vez; com ele, não chama', async () => {
    const csrf = { chamadas: 0 };
    servidor.use(
      handlerDeCsrf(csrf),
      http.post(`${ORIGEM}/api/x`, () => ok()),
    );

    await requisitar('POST', '/api/x', { corpo: {} });
    await requisitar('POST', '/api/x', { corpo: {} });

    expect(csrf.chamadas).toBe(1);
  });

  it('chamadas simultâneas sem cookie compartilham uma só busca do token', async () => {
    const csrf = { chamadas: 0 };
    servidor.use(
      handlerDeCsrf(csrf),
      http.post(`${ORIGEM}/api/x`, () => ok()),
    );

    await Promise.all([requisitar('POST', '/api/x'), requisitar('POST', '/api/x')]);

    expect(csrf.chamadas).toBe(1);
  });

  it('o header X-CSRF-Token é igual ao cookie csrf_token', async () => {
    let enviado: string | null = null;
    servidor.use(
      handlerDeCsrf(),
      http.post(`${ORIGEM}/api/x`, ({ request }) => {
        enviado = request.headers.get('X-CSRF-Token');
        return ok();
      }),
    );

    await requisitar('POST', '/api/x');

    expect(enviado).toBe(lerCookie('csrf_token'));
    expect(enviado).toBe('token-de-teste');
  });

  it('GET não busca nem envia o token', async () => {
    const csrf = { chamadas: 0 };
    let enviado: string | null = 'x';
    servidor.use(
      handlerDeCsrf(csrf),
      http.get(`${ORIGEM}/api/x`, ({ request }) => {
        enviado = request.headers.get('X-CSRF-Token');
        return ok();
      }),
    );

    await requisitar('GET', '/api/x');

    expect(csrf.chamadas).toBe(0);
    expect(enviado).toBeNull();
  });

  it.each(['PUT', 'PATCH', 'DELETE'] as const)('%s leva o header', async (metodo) => {
    definirCookie('csrf_token', 'abc');
    let enviado: string | null = null;
    servidor.use(
      http.all(`${ORIGEM}/api/x`, ({ request }) => {
        enviado = request.headers.get('X-CSRF-Token');
        return ok();
      }),
    );

    await requisitar(metodo, '/api/x');

    expect(enviado).toBe('abc');
  });
});

describe('erros', () => {
  it('lança ErroDaApi com status, código, detalhes e Retry-After', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/x`, () =>
        HttpResponse.json(
          {
            sucesso: false,
            erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'm', detalhes: { a: 1 } },
          },
          { status: 429, headers: { 'Retry-After': '17' } },
        ),
      ),
    );

    const erro = await requisitar('GET', '/api/x').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect(erro).toMatchObject({
      status: 429,
      codigo: 'MUITAS_TENTATIVAS',
      detalhes: { a: 1 },
      retryAfterSegundos: 17,
    });
  });

  it('falha de rede vira INDISPONIVEL com status 0', async () => {
    servidor.use(http.get(`${ORIGEM}/api/x`, () => HttpResponse.error()));

    const erro = await requisitar('GET', '/api/x').catch((e: unknown) => e);

    expect(erro).toMatchObject({ status: 0, codigo: 'INDISPONIVEL' });
  });

  it('resposta que não é o envelope (ex.: HTML do proxy) vira INDISPONIVEL', async () => {
    servidor.use(
      http.get(
        `${ORIGEM}/api/x`,
        () => new HttpResponse('<html>bad gateway</html>', { status: 502 }),
      ),
    );

    const erro = await requisitar('GET', '/api/x').catch((e: unknown) => e);

    expect(erro).toMatchObject({ status: 502, codigo: 'INDISPONIVEL' });
  });

  it('204 devolve undefined', async () => {
    servidor.use(http.get(`${ORIGEM}/api/x`, () => new HttpResponse(null, { status: 204 })));
    await expect(requisitar('GET', '/api/x')).resolves.toBeUndefined();
  });
});

describe('refresh silencioso', () => {
  it('3 requisições simultâneas com 401 NAO_AUTENTICADO → 1 refresh e as 3 são repetidas', async () => {
    definirCookie('csrf_token', 'abc');
    let refreshes = 0;
    let renovado = false;
    const tentativas = { n: 0 };
    servidor.use(
      http.post(`${ORIGEM}/api/auth/refresh`, async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 20));
        renovado = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${ORIGEM}/api/x`, () => {
        tentativas.n += 1;
        return renovado ? ok() : envelopeDeErro('NAO_AUTENTICADO', 401);
      }),
    );

    const resultados = await Promise.all([
      requisitar('GET', '/api/x'),
      requisitar('GET', '/api/x'),
      requisitar('GET', '/api/x'),
    ]);

    expect(refreshes).toBe(1);
    expect(resultados).toHaveLength(3);
    expect(tentativas.n).toBe(6);
  });

  it('repete a requisição só uma vez: segundo 401 é devolvido', async () => {
    definirCookie('csrf_token', 'abc');
    let chamadas = 0;
    servidor.use(
      http.post(`${ORIGEM}/api/auth/refresh`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${ORIGEM}/api/x`, () => {
        chamadas += 1;
        return envelopeDeErro('NAO_AUTENTICADO', 401);
      }),
    );

    const erro = await requisitar('GET', '/api/x').catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: 'NAO_AUTENTICADO' });
    expect(chamadas).toBe(2);
  });

  it('refresh 401 → ErroDaApi SESSAO_EXPIRADA e avisa os ouvintes uma vez', async () => {
    definirCookie('csrf_token', 'abc');
    const ouvinte = vi.fn();
    const parar = ouvirSessaoExpirada(ouvinte);
    servidor.use(
      http.post(`${ORIGEM}/api/auth/refresh`, () => envelopeDeErro('SESSAO_EXPIRADA', 401)),
      http.get(`${ORIGEM}/api/x`, () => envelopeDeErro('NAO_AUTENTICADO', 401)),
    );

    const erros = await Promise.all([
      requisitar('GET', '/api/x').catch((e: unknown) => e),
      requisitar('GET', '/api/x').catch((e: unknown) => e),
    ]);
    parar();

    expect(erros).toEqual([
      expect.objectContaining({ codigo: 'SESSAO_EXPIRADA' }),
      expect.objectContaining({ codigo: 'SESSAO_EXPIRADA' }),
    ]);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('401 de outro código (login) não dispara refresh', async () => {
    definirCookie('csrf_token', 'abc');
    let refreshes = 0;
    servidor.use(
      http.post(`${ORIGEM}/api/auth/refresh`, () => {
        refreshes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${ORIGEM}/api/auth/login`, () => envelopeDeErro('CREDENCIAIS_INVALIDAS', 401)),
    );

    const erro = await requisitar('POST', '/api/auth/login', { corpo: {} }).catch(
      (e: unknown) => e,
    );

    expect(erro).toMatchObject({ codigo: 'CREDENCIAIS_INVALIDAS' });
    expect(refreshes).toBe(0);
  });
});
