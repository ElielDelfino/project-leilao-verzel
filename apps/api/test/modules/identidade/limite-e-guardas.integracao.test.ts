// Integração (Postgres e Redis reais): rate limit (specs/003 RNF-02, RNF-04, §Rate limit), guards
// e ordem das verificações (§Ordem), Secure dos cookies por WEB_ORIGIN (§Cookies).
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import { criarConexaoDoRedis } from '../../../src/redis/conexao.js';
import { criarAppDeTeste } from '../../helpers/app-de-teste.js';
import { portaFechada } from '../../helpers/porta-fechada.js';
import {
  type AppDeIdentidade,
  cadastrar,
  CHAVE_JWT,
  criarAppDeIdentidade,
  emailNovo,
  envReal,
  INFRA_DISPONIVEL,
  Navegador,
  SENHA,
} from './ambiente.js';
import { ModuloDeGuardas } from './modulo-de-guardas.js';

function retryAfter(resposta: LightMyRequestResponse): number {
  const valor = resposta.headers['retry-after'];
  expect(valor).toMatch(/^[0-9]+$/);
  return Number(valor);
}

function esperar429(resposta: LightMyRequestResponse): void {
  expect(resposta.statusCode).toBe(429);
  expect(resposta.json()).toEqual({
    sucesso: false,
    erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: expect.any(String) },
  });
  const segundos = retryAfter(resposta);
  expect(segundos).toBeGreaterThanOrEqual(1);
  expect(segundos).toBeLessThanOrEqual(60);
}

describe.skipIf(!INFRA_DISPONIVEL)('rate limit, guards e ordem das verificações', () => {
  let ctx: AppDeIdentidade;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade({ modulosExtras: [ModuloDeGuardas] });
  });

  afterEach(async () => {
    await ctx.resetarLimite();
  });

  afterAll(async () => {
    await ctx.fechar();
  });

  describe('cadastro: 5 por minuto por IP (RNF-04)', () => {
    it('o 6º cadastro do mesmo IP → 429 com Retry-After entre 1 e 60', async () => {
      const navegador = new Navegador(ctx.app, '10.1.0.1');
      for (let i = 0; i < 5; i++) {
        expect((await cadastrar(navegador)).resposta.statusCode).toBe(201);
      }

      esperar429((await cadastrar(navegador)).resposta);
      expect((await cadastrar(new Navegador(ctx.app, '10.1.0.2'))).resposta.statusCode).toBe(201);
    });

    it('5 cadastros com 409 EMAIL_EM_USO já consomem a janela', async () => {
      const email = emailNovo();
      await cadastrar(new Navegador(ctx.app, '10.1.1.1'), { email });
      await ctx.resetarLimite();
      const navegador = new Navegador(ctx.app, '10.1.1.1');
      for (let i = 0; i < 5; i++) {
        expect((await cadastrar(navegador, { email })).resposta.statusCode).toBe(409);
      }

      esperar429((await cadastrar(navegador)).resposta);
    });

    it('corpo inválido (422) não conta', async () => {
      const navegador = new Navegador(ctx.app, '10.1.2.1');
      await navegador.obterCsrf();
      for (let i = 0; i < 6; i++) {
        const resposta = await navegador.post('/api/auth/cadastro', { nome: 'x' });
        expect(resposta.statusCode).toBe(422);
      }

      expect((await cadastrar(navegador)).resposta.statusCode).toBe(201);
    });
  });

  describe('login: 5 por minuto por IP + e-mail (RNF-02)', () => {
    it('o 6º login do mesmo IP e e-mail → 429; o login certo também conta', async () => {
      const { email } = await cadastrar(new Navegador(ctx.app, '10.2.0.9'));
      const navegador = new Navegador(ctx.app, '10.2.0.1');
      await navegador.obterCsrf();
      expect((await navegador.post('/api/auth/login', { email, senha: SENHA })).statusCode).toBe(
        200,
      );
      for (let i = 0; i < 4; i++) {
        await navegador.post('/api/auth/login', { email, senha: 'senha-errada' });
      }

      esperar429(await navegador.post('/api/auth/login', { email, senha: SENHA }));
    });

    it('maiúsculas no e-mail não escapam do limite; outro e-mail do mesmo IP passa', async () => {
      const email = emailNovo();
      const navegador = new Navegador(ctx.app, '10.2.1.1');
      await navegador.obterCsrf();
      for (let i = 0; i < 5; i++) {
        const variante = i % 2 === 0 ? email : email.toUpperCase();
        expect(
          (await navegador.post('/api/auth/login', { email: variante, senha: 'x' })).statusCode,
        ).toBe(401);
      }

      esperar429(
        await navegador.post('/api/auth/login', { email: email.toUpperCase(), senha: 'x' }),
      );
      const outro = await navegador.post('/api/auth/login', { email: emailNovo(), senha: 'x' });
      expect(outro.statusCode).toBe(401);
    });

    it('corpo inválido repetido 6 vezes → sempre 422, nunca 429', async () => {
      const navegador = new Navegador(ctx.app, '10.2.2.1');
      await navegador.obterCsrf();
      const email = emailNovo();

      for (let i = 0; i < 6; i++) {
        const resposta = await navegador.post('/api/auth/login', { email, senha: '' });
        expect(resposta.statusCode).toBe(422);
      }
    });
  });

  describe('guards (@Publico, @Papel, @UsuarioAtual)', () => {
    async function logado(papel: 'leiloeiro' | 'licitante', ip: string): Promise<Navegador> {
      const navegador = new Navegador(ctx.app, ip);
      await cadastrar(navegador, { papel });
      return navegador;
    }

    it('@Publico() sem sessão → 200', async () => {
      const resposta = await new Navegador(ctx.app).get('/api/teste-guardas/publica');

      expect(resposta.statusCode).toBe(200);
    });

    it('rota sem anotação exige sessão: 401 NAO_AUTENTICADO sem cookie', async () => {
      const resposta = await new Navegador(ctx.app).get('/api/teste-guardas/sessao');

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ erro: { codigo: 'NAO_AUTENTICADO' } });
    });

    it('@UsuarioAtual entrega id e papel da sessão', async () => {
      const navegador = await logado('leiloeiro', '10.3.0.1');

      const resposta = await navegador.get('/api/teste-guardas/sessao');

      expect(resposta.json()).toEqual({
        sucesso: true,
        dados: { id: expect.any(String), papel: 'leiloeiro' },
      });
    });

    it("@Papel('licitante') chamada por leiloeiro → 403 PAPEL_NAO_PERMITIDO, e vice-versa", async () => {
      const leiloeiro = await logado('leiloeiro', '10.3.1.1');
      const licitante = await logado('licitante', '10.3.1.2');

      const recusas = [
        await leiloeiro.get('/api/teste-guardas/licitante'),
        await licitante.get('/api/teste-guardas/leiloeiro'),
      ];

      for (const resposta of recusas) {
        expect(resposta.statusCode).toBe(403);
        expect(resposta.json()).toEqual({
          sucesso: false,
          erro: { codigo: 'PAPEL_NAO_PERMITIDO', mensagem: expect.any(String) },
        });
      }
      expect((await licitante.get('/api/teste-guardas/licitante')).statusCode).toBe(200);
      expect((await leiloeiro.get('/api/teste-guardas/leiloeiro')).statusCode).toBe(200);
    });

    describe('@SessaoOpcional() (task 053)', () => {
      const URL = '/api/teste-guardas/opcional';
      const ID = '00000000-0000-4000-8000-000000000053';

      function comAccess(token: string): Navegador {
        const navegador = new Navegador(ctx.app);
        navegador.cookies.set('access_token', token);
        return navegador;
      }

      it('anônimo → 200 sem usuario', async () => {
        const resposta = await new Navegador(ctx.app).get(URL);

        expect(resposta.statusCode).toBe(200);
        expect(resposta.json()).toEqual({ sucesso: true, dados: { usuario: null } });
      });

      it('token válido → 200 com id e papel', async () => {
        const navegador = await logado('licitante', '10.3.2.1');

        const resposta = await navegador.get(URL);

        expect(resposta.statusCode).toBe(200);
        expect(resposta.json()).toEqual({
          sucesso: true,
          dados: { usuario: { id: expect.any(String), papel: 'licitante' } },
        });
      });

      it('token expirado → 200 anônimo, sem refresh nem cookies novos', async () => {
        const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const token = await emitirAccessToken(CHAVE_JWT, { id: ID, papel: 'leiloeiro' }, ontem);

        const resposta = await comAccess(token).get(URL);

        expect(resposta.statusCode).toBe(200);
        expect(resposta.json()).toEqual({ sucesso: true, dados: { usuario: null } });
        expect(resposta.cookies).toHaveLength(0);
      });

      it.each([
        [
          'assinatura trocada',
          (t: string): string => {
            // Troca o 1º caractere da assinatura por outro sempre diferente (nunca é o original).
            const i = t.lastIndexOf('.') + 1;
            return `${t.slice(0, i)}${t[i] === 'A' ? 'B' : 'A'}${t.slice(i + 1)}`;
          },
        ],
        ['payload trocado', (t: string): string => t.replace(/\.[^.]+\./, '.e30.')],
        ['lixo', (): string => 'nao-e-um-jwt'],
      ])('token adulterado (%s) → 200 anônimo', async (_nome, adulterar) => {
        const token = await emitirAccessToken(CHAVE_JWT, { id: ID, papel: 'leiloeiro' });

        const resposta = await comAccess(adulterar(token)).get(URL);

        expect(resposta.statusCode).toBe(200);
        expect(resposta.json()).toEqual({ sucesso: true, dados: { usuario: null } });
      });

      it('token assinado com outra chave → 200 anônimo', async () => {
        const outra = new Uint8Array(32).fill(7);
        const token = await emitirAccessToken(outra, { id: ID, papel: 'leiloeiro' });

        const resposta = await comAccess(token).get(URL);

        expect(resposta.json()).toEqual({ sucesso: true, dados: { usuario: null } });
      });

      it('o CSRF continua valendo: POST sem X-CSRF-Token → 403; com → 200', async () => {
        const navegador = new Navegador(ctx.app);
        await navegador.obterCsrf();

        const sem = await navegador.post(URL, undefined, { semCsrf: true });
        const com = await navegador.post(URL);

        expect(sem.statusCode).toBe(403);
        expect(sem.json()).toMatchObject({ erro: { codigo: 'CSRF_INVALIDO' } });
        expect(com.statusCode).toBe(200);
      });

      it('rota sem o decorator continua exigindo sessão com token expirado → 401', async () => {
        const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const token = await emitirAccessToken(CHAVE_JWT, { id: ID, papel: 'leiloeiro' }, ontem);

        const resposta = await comAccess(token).get('/api/teste-guardas/sessao');

        expect(resposta.statusCode).toBe(401);
        expect(resposta.json()).toMatchObject({ erro: { codigo: 'NAO_AUTENTICADO' } });
      });

      describe('combinação com @Papel ou @Publico falha fechada (500 genérico)', () => {
        const ROTAS = [
          [
            'classe opcional + método @Papel',
            '/api/teste-guardas/opcional-na-classe/papel-no-metodo',
          ],
          [
            'classe @Papel + método opcional',
            '/api/teste-guardas/papel-na-classe/opcional-no-metodo',
          ],
          [
            'classe opcional + método @Publico',
            '/api/teste-guardas/opcional-na-classe/publico-no-metodo',
          ],
          [
            'classe @Publico + método opcional',
            '/api/teste-guardas/publico-na-classe/opcional-no-metodo',
          ],
          [
            'opcional + @Papel no mesmo método',
            '/api/teste-guardas/publico-na-classe/tudo-no-metodo',
          ],
        ] as const;

        function esperar500(resposta: LightMyRequestResponse): void {
          expect(resposta.statusCode).toBe(500);
          expect(resposta.json()).toEqual({
            sucesso: false,
            erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) },
          });
          expect(resposta.body).not.toMatch(/SessaoOpcional|Papel|Publico/);
        }

        it.each(ROTAS)('%s: anônimo → 500', async (_nome, rota) => {
          esperar500(await new Navegador(ctx.app).get(rota));
        });

        it.each(ROTAS)('%s: leiloeiro logado → 500', async (_nome, rota) => {
          const leiloeiro = await logado('leiloeiro', '10.3.3.1');

          esperar500(await leiloeiro.get(rota));
        });
      });
    });

    describe('ordem: CSRF → autenticação → papel → validação (specs/003 §Ordem)', () => {
      const URL = '/api/teste-guardas/deposito';
      const INVALIDO = { valorCentavos: 'muito' };

      it('sem X-CSRF-Token e sem sessão → 403 CSRF_INVALIDO', async () => {
        const resposta = await new Navegador(ctx.app).post(URL, INVALIDO, { semCsrf: true });

        expect(resposta.statusCode).toBe(403);
        expect(resposta.json()).toMatchObject({ erro: { codigo: 'CSRF_INVALIDO' } });
      });

      it('com CSRF e sem sessão → 401', async () => {
        const navegador = new Navegador(ctx.app);
        await navegador.obterCsrf();

        expect((await navegador.post(URL, INVALIDO)).statusCode).toBe(401);
      });

      it('leiloeiro com corpo inválido → 403 PAPEL_NAO_PERMITIDO', async () => {
        const resposta = await (await logado('leiloeiro', '10.4.0.1')).post(URL, INVALIDO);

        expect(resposta.statusCode).toBe(403);
        expect(resposta.json()).toMatchObject({ erro: { codigo: 'PAPEL_NAO_PERMITIDO' } });
      });

      it('licitante com corpo inválido → 422; com corpo válido → 201', async () => {
        const licitante = await logado('licitante', '10.4.0.2');

        expect((await licitante.post(URL, INVALIDO)).statusCode).toBe(422);
        expect((await licitante.post(URL, { valorCentavos: 100, extra: 1 })).statusCode).toBe(422);
        expect((await licitante.post(URL, { valorCentavos: 100 })).statusCode).toBe(201);
      });
    });
  });
});

describe.skipIf(!INFRA_DISPONIVEL)('Secure dos cookies por WEB_ORIGIN (specs/003 §Cookies)', () => {
  it.each([
    ['http://localhost:15173', false],
    ['https://10-0-0-1.sslip.io', true],
  ])('WEB_ORIGIN=%s → Secure %s nos três cookies', async (webOrigin, seguro) => {
    const ctx = await criarAppDeIdentidade({ webOrigin });
    try {
      const navegador = new Navegador(ctx.app, '10.5.0.1');
      const { resposta } = await cadastrar(navegador);
      const logout = await navegador.post('/api/auth/logout');

      for (const cookie of [...resposta.cookies, ...logout.cookies]) {
        expect(cookie.secure === true).toBe(seguro);
      }
      expect(resposta.cookies).toHaveLength(3);
      expect(logout.cookies).toHaveLength(3);
    } finally {
      await ctx.fechar();
    }
  });
});

describe.skipIf(!INFRA_DISPONIVEL)('rate limit com o Redis fora', () => {
  it('login → 500 INDISPONIVEL (falha fechada), sem detalhes', async () => {
    const real = envReal();
    const app = await criarAppDeTeste({
      env: {
        ...real,
        redis: criarConexaoDoRedis(
          { host: real.redis.host, port: await portaFechada() },
          real.redis.password,
        ),
      },
      clientesReais: true,
    });
    try {
      const navegador = new Navegador(app);
      await navegador.obterCsrf();

      const resposta = await navegador.post('/api/auth/login', { email: emailNovo(), senha: 'x' });

      expect(resposta.statusCode).toBe(500);
      expect(resposta.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) },
      });
    } finally {
      await app.close();
    }
  });
});
