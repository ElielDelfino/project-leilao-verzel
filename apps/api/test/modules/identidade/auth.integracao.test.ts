// Integração (Postgres e Redis reais): rotas de auth (specs/003 §Comportamento, §Cookies,
// §Critérios de aceite; openapi.yaml tag auth).
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ServicoDeSenha } from '../../../src/modules/identidade/servico-de-senha.js';
import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import {
  type AppDeIdentidade,
  BANCO,
  cadastrar,
  CHAVE_JWT,
  criarAppDeIdentidade,
  emailNovo,
  INFRA_DISPONIVEL,
  Navegador,
  SENHA,
} from './ambiente.js';

const UMA_SEMANA = 604_800;

async function consultar<T extends pg.QueryResultRow>(
  texto: string,
  valores: unknown[],
): Promise<T[]> {
  const cliente = new pg.Client(BANCO.conexao());
  await cliente.connect();
  try {
    return (await cliente.query<T>(texto, valores)).rows;
  } finally {
    await cliente.end();
  }
}

describe.skipIf(!INFRA_DISPONIVEL)('auth com Postgres e Redis reais', () => {
  let ctx: AppDeIdentidade;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await ctx.resetarLimite();
  });

  afterAll(async () => {
    await ctx.fechar();
  });

  describe('GET /api/auth/csrf', () => {
    it('204 e cookie csrf_token: Path=/, 7 dias, sem HttpOnly, SameSite=Lax, sem Secure em http', async () => {
      const resposta = await new Navegador(ctx.app).get('/api/auth/csrf');

      expect(resposta.statusCode).toBe(204);
      expect(resposta.cookies).toEqual([
        {
          name: 'csrf_token',
          value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
          path: '/',
          maxAge: UMA_SEMANA,
          sameSite: 'Lax',
        },
      ]);
    });
  });

  describe('POST /api/auth/cadastro', () => {
    it('201 { usuario } e os três cookies com os atributos de specs/003 §Cookies', async () => {
      const navegador = new Navegador(ctx.app);

      const { email, resposta } = await cadastrar(navegador, { papel: 'leiloeiro' });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json()).toEqual({
        sucesso: true,
        dados: {
          usuario: {
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            nome: 'Conta de Teste',
            email,
            papel: 'leiloeiro',
          },
        },
      });
      const porNome = Object.fromEntries(resposta.cookies.map((c) => [c.name, c]));
      expect(porNome['access_token']).toEqual({
        name: 'access_token',
        value: expect.any(String),
        path: '/',
        maxAge: 900,
        httpOnly: true,
        sameSite: 'Lax',
      });
      expect(porNome['refresh_token']).toEqual({
        name: 'refresh_token',
        value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        path: '/api/auth',
        maxAge: UMA_SEMANA,
        httpOnly: true,
        sameSite: 'Lax',
      });
      expect(porNome['csrf_token']).toEqual({
        name: 'csrf_token',
        value: expect.any(String),
        path: '/',
        maxAge: UMA_SEMANA,
        sameSite: 'Lax',
      });
    });

    it('grava o senha_hash em PHC argon2id com os parâmetros do RNF-01', async () => {
      const { email } = await cadastrar(new Navegador(ctx.app));

      const [linha] = await consultar<{ senha_hash: string }>(
        'select senha_hash from users where email = $1',
        [email],
      );

      expect(linha?.senha_hash).toMatch(
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
      );
    });

    it('guarda no banco só o SHA-256 do refresh token, na família nova', async () => {
      const navegador = new Navegador(ctx.app);
      const { resposta } = await cadastrar(navegador);
      const id = (resposta.json() as { dados: { usuario: { id: string } } }).dados.usuario.id;

      const linhas = await consultar<{ token_hash: Buffer }>(
        'select token_hash from refresh_tokens where user_id = $1',
        [id],
      );

      const token = navegador.cookies.get('refresh_token') ?? '';
      expect(linhas).toHaveLength(1);
      expect(linhas[0]?.token_hash).toHaveLength(32);
      expect(linhas[0]?.token_hash.toString('base64url')).not.toBe(token);
    });

    it('e-mail repetido com outra caixa → 409 EMAIL_EM_USO', async () => {
      const email = emailNovo();
      await cadastrar(new Navegador(ctx.app), { email });

      const { resposta } = await cadastrar(new Navegador(ctx.app), {
        email: email.toUpperCase(),
      });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'EMAIL_EM_USO', mensagem: expect.any(String) },
      });
      expect(resposta.cookies).toEqual([]);
    });

    it('campo desconhecido → 422 DADOS_INVALIDOS', async () => {
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const resposta = await navegador.post('/api/auth/cadastro', {
        nome: 'Ana',
        email: emailNovo(),
        senha: SENHA,
        papel: 'licitante',
        admin: true,
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.json()).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS' } });
    });

    it('senha de 128 caracteres é aceita e a de 129 → 422', async () => {
      const aceita = await cadastrar(new Navegador(ctx.app), { senha: 'a'.repeat(128) });
      const recusada = await cadastrar(new Navegador(ctx.app), { senha: 'a'.repeat(129) });

      expect(aceita.resposta.statusCode).toBe(201);
      expect(recusada.resposta.statusCode).toBe(422);
    });

    it.each([
      ['senha com 9 caracteres', { senha: 'a'.repeat(9) }],
      ['nome com 1 caractere', { nome: 'A' }],
      ['nome com 81 caracteres', { nome: 'a'.repeat(81) }],
      ['papel desconhecido', { papel: 'admin' }],
      ['e-mail inválido', { email: 'nao-e-email' }],
      ['e-mail com 255 caracteres', { email: `${'a'.repeat(243)}@teste.local` }],
    ])('%s → 422', async (_, troca) => {
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const resposta = await navegador.post('/api/auth/cadastro', {
        nome: 'Ana',
        email: emailNovo(),
        senha: SENHA,
        papel: 'licitante',
        ...troca,
      });

      expect(resposta.statusCode).toBe(422);
    });
  });

  describe('CSRF (double-submit)', () => {
    it('POST sem X-CSRF-Token → 403 CSRF_INVALIDO', async () => {
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const resposta = await navegador.post(
        '/api/auth/login',
        { email: emailNovo(), senha: SENHA },
        { semCsrf: true },
      );

      expect(resposta.statusCode).toBe(403);
      expect(resposta.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'CSRF_INVALIDO', mensagem: expect.any(String) },
      });
    });

    it.each([
      ['valor diferente, mesmo tamanho', () => randomBytes(32).toString('base64url')],
      ['valor de outro tamanho', () => 'curto'],
    ])('X-CSRF-Token com %s → 403 CSRF_INVALIDO', async (_, outro) => {
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const resposta = await navegador.post('/api/auth/logout', undefined, { csrf: outro() });

      expect(resposta.statusCode).toBe(403);
      expect(resposta.json()).toMatchObject({ erro: { codigo: 'CSRF_INVALIDO' } });
    });

    it('header sem o cookie csrf_token → 403 CSRF_INVALIDO', async () => {
      const resposta = await new Navegador(ctx.app).post('/api/auth/logout', undefined, {
        csrf: randomBytes(32).toString('base64url'),
      });

      expect(resposta.statusCode).toBe(403);
    });
  });

  describe('GET /api/auth/me', () => {
    it('sem cookie → 401 NAO_AUTENTICADO', async () => {
      const resposta = await new Navegador(ctx.app).get('/api/auth/me');

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'NAO_AUTENTICADO', mensagem: expect.any(String) },
      });
    });

    it('com sessão → 200 { id, nome, email, papel }', async () => {
      const navegador = new Navegador(ctx.app);
      const { email, resposta: cadastro } = await cadastrar(navegador);

      const resposta = await navegador.get('/api/auth/me');

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        sucesso: true,
        dados: { ...(cadastro.json() as { dados: { usuario: object } }).dados.usuario, email },
      });
    });

    async function meCom(token: string): Promise<number> {
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: `access_token=${token}` },
      });
      return resposta.statusCode;
    }

    it('access token expirado → 401', async () => {
      const navegador = new Navegador(ctx.app);
      const { resposta } = await cadastrar(navegador);
      const { id } = (resposta.json() as { dados: { usuario: { id: string } } }).dados.usuario;

      const expirado = await emitirAccessToken(
        CHAVE_JWT,
        { id, papel: 'licitante' },
        new Date(Date.now() - 16 * 60_000),
      );

      expect(await meCom(expirado)).toBe(401);
    });

    it('access token assinado com outra chave → 401', async () => {
      const token = await emitirAccessToken(new Uint8Array(randomBytes(32)), {
        id: randomUUID(),
        papel: 'licitante',
      });

      expect(await meCom(token)).toBe(401);
    });

    it('access token com alg diferente de HS256 → 401', async () => {
      const token = await new SignJWT({ papel: 'licitante' })
        .setProtectedHeader({ alg: 'HS512' })
        .setSubject(randomUUID())
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(CHAVE_JWT);

      expect(await meCom(token)).toBe(401);
    });
  });

  describe('POST /api/auth/login', () => {
    it('200 { usuario } e cookies novos; e-mail com outra caixa também entra', async () => {
      const { email } = await cadastrar(new Navegador(ctx.app));
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const resposta = await navegador.post('/api/auth/login', {
        email: email.toUpperCase(),
        senha: SENHA,
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ sucesso: true, dados: { usuario: { email } } });
      expect(resposta.cookies.map((c) => c.name).sort()).toEqual([
        'access_token',
        'csrf_token',
        'refresh_token',
      ]);
      expect((await navegador.get('/api/auth/me')).statusCode).toBe(200);
    });

    it('senha errada e e-mail inexistente: 401 CREDENCIAIS_INVALIDAS com o mesmo corpo', async () => {
      const { email } = await cadastrar(new Navegador(ctx.app));
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const errada = await navegador.post('/api/auth/login', { email, senha: 'outra-senha-1' });
      const inexistente = await navegador.post('/api/auth/login', {
        email: emailNovo(),
        senha: 'outra-senha-1',
      });

      expect(errada.statusCode).toBe(401);
      expect(inexistente.statusCode).toBe(401);
      expect(errada.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: expect.any(String) },
      });
      expect(inexistente.body).toBe(errada.body);
      expect(errada.cookies).toEqual([]);
    });

    it('RNF-03: e-mail inexistente verifica uma vez, contra o hash dummy', async () => {
      const servico = ctx.app.get(ServicoDeSenha);
      const espiao = vi.spyOn(servico, 'verificar');
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const resposta = await navegador.post('/api/auth/login', {
        email: emailNovo(),
        senha: 'qualquer-senha',
      });

      expect(resposta.statusCode).toBe(401);
      expect(espiao).toHaveBeenCalledTimes(1);
      expect(espiao).toHaveBeenCalledWith('qualquer-senha', servico.hashDummy);
      expect(servico.hashDummy).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    });

    it('login com um refresh_token antigo revoga a família antiga', async () => {
      const navegador = new Navegador(ctx.app);
      const { email } = await cadastrar(navegador);
      const tokenAntigo = navegador.cookies.get('refresh_token') ?? '';

      const login = await navegador.post('/api/auth/login', { email, senha: SENHA });
      expect(login.statusCode).toBe(200);

      const outro = new Navegador(ctx.app);
      await outro.obterCsrf();
      outro.cookies.set('refresh_token', tokenAntigo);
      const reuso = await outro.post('/api/auth/refresh');

      expect(reuso.statusCode).toBe(401);
      expect(reuso.json()).toMatchObject({ erro: { codigo: 'SESSAO_EXPIRADA' } });
      expect((await navegador.post('/api/auth/refresh')).statusCode).toBe(204);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('204 com os três cookies novos, na mesma família', async () => {
      const navegador = new Navegador(ctx.app);
      await cadastrar(navegador);
      const antes = new Map(navegador.cookies);

      const resposta = await navegador.post('/api/auth/refresh');

      expect(resposta.statusCode).toBe(204);
      expect(resposta.cookies.map((c) => c.name).sort()).toEqual([
        'access_token',
        'csrf_token',
        'refresh_token',
      ]);
      expect(navegador.cookies.get('refresh_token')).not.toBe(antes.get('refresh_token'));
      const familias = await consultar<{ n: string }>(
        `select count(distinct familia_id) as n from refresh_tokens
          where token_hash = any($1::bytea[])`,
        [
          [antes.get('refresh_token'), navegador.cookies.get('refresh_token')].map((token) =>
            hash(token ?? ''),
          ),
        ],
      );
      expect(familias[0]?.n).toBe('1');
    });

    it('reuso de um token substituído revoga a família: o mais novo também dá 401', async () => {
      const navegador = new Navegador(ctx.app);
      await cadastrar(navegador);
      const primeiro = navegador.cookies.get('refresh_token') ?? '';
      expect((await navegador.post('/api/auth/refresh')).statusCode).toBe(204);

      const atacante = new Navegador(ctx.app);
      await atacante.obterCsrf();
      atacante.cookies.set('refresh_token', primeiro);
      const reuso = await atacante.post('/api/auth/refresh');

      expect(reuso.statusCode).toBe(401);
      expect(reuso.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'SESSAO_EXPIRADA', mensagem: expect.any(String) },
      });
      expect((await navegador.post('/api/auth/refresh')).statusCode).toBe(401);
    });

    it.each([
      ['sem cookie', undefined],
      ['token desconhecido', randomBytes(32).toString('base64url')],
      ['texto fora do formato', 'lixo'],
    ])('%s → 401 SESSAO_EXPIRADA', async (_, token) => {
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();
      if (token !== undefined) {
        navegador.cookies.set('refresh_token', token);
      }

      const resposta = await navegador.post('/api/auth/refresh');

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ erro: { codigo: 'SESSAO_EXPIRADA' } });
    });

    it('token expirado → 401 SESSAO_EXPIRADA', async () => {
      const navegador = new Navegador(ctx.app);
      await cadastrar(navegador);
      await consultar(
        `update refresh_tokens set expira_em = now() - interval '1 second' where token_hash = $1`,
        [hash(navegador.cookies.get('refresh_token') ?? '')],
      );

      expect((await navegador.post('/api/auth/refresh')).statusCode).toBe(401);
    });
  });

  describe('concorrência na família do refresh token (revisão da 038)', () => {
    async function tokensVivosDaFamilia(token: string): Promise<number> {
      const linhas = await consultar<{ n: string }>(
        `select count(*) as n from refresh_tokens
          where familia_id = (select familia_id from refresh_tokens where token_hash = $1)
            and revogado_em is null and substituido_por is null`,
        [hash(token)],
      );
      return Number(linhas[0]?.n);
    }

    function comToken(token: string, csrf: string, url: string) {
      return ctx.app.inject({
        method: 'POST',
        url,
        headers: { cookie: `refresh_token=${token}; csrf_token=${csrf}`, 'x-csrf-token': csrf },
      });
    }

    it('dois refresh em paralelo com o mesmo token: exatamente um 204 e um 401', async () => {
      for (let i = 0; i < 5; i++) {
        const navegador = new Navegador(ctx.app);
        await cadastrar(navegador);
        const token = navegador.cookies.get('refresh_token') ?? '';
        const csrf = navegador.cookies.get('csrf_token') ?? '';

        const respostas = await Promise.all([
          comToken(token, csrf, '/api/auth/refresh'),
          comToken(token, csrf, '/api/auth/refresh'),
        ]);

        expect(respostas.map((r) => r.statusCode).sort()).toEqual([204, 401]);
        // O reuso revogou a família: nem o token emitido pelo vencedor sobrevive.
        expect(await tokensVivosDaFamilia(token)).toBe(0);
      }
    });

    it('logout × refresh em voo: nenhum token da família continua válido', async () => {
      for (let i = 0; i < 5; i++) {
        const navegador = new Navegador(ctx.app);
        await cadastrar(navegador);
        const token = navegador.cookies.get('refresh_token') ?? '';
        const csrf = navegador.cookies.get('csrf_token') ?? '';

        const [refresh, logout] = await Promise.all([
          comToken(token, csrf, '/api/auth/refresh'),
          comToken(token, csrf, '/api/auth/logout'),
        ]);

        expect(logout.statusCode).toBe(204);
        expect(await tokensVivosDaFamilia(token)).toBe(0);
        const novo = refresh.cookies.find((c) => c.name === 'refresh_token')?.value;
        if (novo !== undefined) {
          expect((await comToken(novo, csrf, '/api/auth/refresh')).statusCode).toBe(401);
        }
      }
    });

    it('login com o refresh_token de outra conta não revoga a família dela', async () => {
      const dono = new Navegador(ctx.app);
      await cadastrar(dono);
      const tokenDoDono = dono.cookies.get('refresh_token') ?? '';
      const { email } = await cadastrar(new Navegador(ctx.app));
      const outro = new Navegador(ctx.app);
      await outro.obterCsrf();
      outro.cookies.set('refresh_token', tokenDoDono);

      expect((await outro.post('/api/auth/login', { email, senha: SENHA })).statusCode).toBe(200);

      expect((await dono.post('/api/auth/refresh')).statusCode).toBe(204);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('204, revoga a família e expira os três cookies (Max-Age=0, mesmos Path)', async () => {
      const navegador = new Navegador(ctx.app);
      await cadastrar(navegador);
      const refresh = navegador.cookies.get('refresh_token') ?? '';

      const resposta = await navegador.post('/api/auth/logout');

      expect(resposta.statusCode).toBe(204);
      const porNome = Object.fromEntries(resposta.cookies.map((c) => [c.name, c]));
      expect(porNome['access_token']).toMatchObject({
        value: '',
        maxAge: 0,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      });
      expect(porNome['refresh_token']).toMatchObject({
        value: '',
        maxAge: 0,
        path: '/api/auth',
        httpOnly: true,
        sameSite: 'Lax',
      });
      expect(porNome['csrf_token']).toMatchObject({ value: '', maxAge: 0, path: '/' });
      expect(porNome['csrf_token']?.httpOnly).toBeUndefined();
      const [linha] = await consultar<{ revogado_em: Date | null }>(
        'select revogado_em from refresh_tokens where token_hash = $1',
        [hash(refresh)],
      );
      expect(linha?.revogado_em).toBeInstanceOf(Date);
    });

    it('204 mesmo sem sessão', async () => {
      const navegador = new Navegador(ctx.app);
      await navegador.obterCsrf();

      const resposta = await navegador.post('/api/auth/logout');

      expect(resposta.statusCode).toBe(204);
      expect(resposta.cookies).toHaveLength(3);
    });
  });

  describe('logs e respostas sem segredos', () => {
    it('nenhum log contém senha, hash, token ou e-mail; nenhum erro contém senha, hash ou token', async () => {
      ctx.linhas.length = 0;
      const navegador = new Navegador(ctx.app);
      const senha = `senha-unica-${randomUUID()}`;
      const { email, resposta: cadastro } = await cadastrar(navegador, { senha });
      const respostas = [
        cadastro,
        await navegador.post('/api/auth/login', { email, senha: `${senha}-errada` }),
        await navegador.post('/api/auth/login', { email, senha }),
        await navegador.post('/api/auth/refresh'),
        await navegador.get('/api/auth/me'),
        await cadastrar(navegador, { email, senha }).then((r) => r.resposta),
        await navegador.post('/api/auth/logout'),
      ];
      const [linha] = await consultar<{ senha_hash: string }>(
        'select senha_hash from users where email = $1',
        [email],
      );
      const segredos = [
        senha,
        linha?.senha_hash ?? 'sem-hash',
        // Todos os tokens emitidos (access, refresh e csrf) em qualquer resposta.
        ...respostas.flatMap((r) => r.cookies.map((c) => c.value)).filter((v) => v !== ''),
      ];
      expect(segredos.length).toBeGreaterThan(5);

      const logs = JSON.stringify(ctx.linhas);
      for (const valor of [...segredos, email, email.toLowerCase()]) {
        expect(logs).not.toContain(valor);
      }
      for (const resposta of respostas.filter((r) => r.statusCode >= 400)) {
        for (const valor of segredos) {
          expect(resposta.body).not.toContain(valor);
        }
      }
    });
  });
});

/** SHA-256 do refresh token, como em refresh_tokens.token_hash. */
function hash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
