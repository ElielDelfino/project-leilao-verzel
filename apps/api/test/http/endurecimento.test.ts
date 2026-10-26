// Endurecimento HTTP da API de produção (tarefa 020): cabeçalhos de segurança, origem em rotas que
// mudam estado, x-request-id, bodyLimit e timeouts. Sobe a API de verdade (criarApi, o caminho do
// main.ts) numa porta efêmera do loopback: os cabeçalhos das respostas do roteador do Fastify (400
// e 414) só aparecem numa conexão real, porque o `inject` não passa pelo servidor HTTP do Node.
// Nenhum caso aqui chega ao banco ou ao Redis (ENV_DE_TESTE aponta os dois para a porta 1).
import { request as requisicaoHttp } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CABECALHOS_DE_SEGURANCA,
  LIMITE_DO_CORPO_BYTES,
  TIMEOUTS_HTTP,
} from '../../src/common/http/index.js';
import { criarApi } from '../../src/servidor.js';
import { ENV_DE_TESTE } from '../helpers/app-de-teste.js';
import { UUID } from '../helpers/captura-de-logs.js';

const ORIGEM_DA_SPA = ENV_DE_TESTE.WEB_ORIGIN;
const ORIGEM_ESTRANHA = 'https://malicioso.exemplo.com';
const TOKEN_CSRF = 'a'.repeat(43);

interface Resposta {
  readonly status: number;
  readonly cabecalhos: Readonly<Record<string, string | string[] | undefined>>;
  readonly corpo: string;
}

let app: NestFastifyApplication;
let porta: number;

/** Requisição HTTP/1.1 crua (o caminho vai sem normalização, ao contrário do fetch). */
function chamar(
  metodo: string,
  caminho: string,
  cabecalhos: Record<string, string> = {},
  corpo?: string,
  portaAlvo: number = porta,
): Promise<Resposta> {
  return new Promise((resolver, rejeitar) => {
    const req = requisicaoHttp(
      { host: '127.0.0.1', port: portaAlvo, method: metodo, path: caminho, headers: cabecalhos },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (parte: Buffer) => partes.push(parte));
        res.on('end', () =>
          resolver({
            status: res.statusCode ?? 0,
            cabecalhos: res.headers,
            corpo: Buffer.concat(partes).toString('utf8'),
          }),
        );
        res.on('error', rejeitar);
      },
    );
    req.on('error', rejeitar);
    if (corpo !== undefined) {
      req.write(corpo);
    }
    req.end();
  });
}

function postJson(corpo: string, origem?: string): Promise<Resposta> {
  return chamar(
    'POST',
    '/api/auth/login',
    {
      'content-type': 'application/json',
      cookie: `csrf_token=${TOKEN_CSRF}`,
      'x-csrf-token': TOKEN_CSRF,
      ...(origem === undefined ? {} : { origin: origem }),
    },
    corpo,
  );
}

function esperarCabecalhosDeSeguranca(resposta: Resposta): void {
  for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
    expect(resposta.cabecalhos[nome], nome).toBe(valor);
  }
}

function esperarSemCors(resposta: Resposta): void {
  const nomes = Object.keys(resposta.cabecalhos).filter((nome) =>
    nome.startsWith('access-control-'),
  );
  expect(nomes).toEqual([]);
}

beforeAll(async () => {
  app = await criarApi(ENV_DE_TESTE);
  await app.listen(0, '127.0.0.1');
  porta = (app.getHttpServer().address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
});

describe('cabeçalhos de segurança (tarefa 020)', () => {
  it('saem numa resposta 200 de rota da API', async () => {
    const resposta = await chamar('GET', '/api/health/live');

    expect(resposta.status).toBe(200);
    esperarCabecalhosDeSeguranca(resposta);
  });

  it('saem no 404 de rota inexistente', async () => {
    const resposta = await chamar('GET', '/api/nao-existe');

    expect(resposta.status).toBe(404);
    esperarCabecalhosDeSeguranca(resposta);
  });

  it('saem no 400 do roteador (URL malformada), que fica no envelope', async () => {
    const resposta = await chamar('GET', '/api/lotes/%E0%A4%A');

    expect(resposta.status).toBe(400);
    expect(JSON.parse(resposta.corpo)).toMatchObject({
      sucesso: false,
      erro: { codigo: 'DADOS_INVALIDOS' },
    });
    esperarCabecalhosDeSeguranca(resposta);
  });

  it('saem no 414 do roteador (parâmetro longo demais)', async () => {
    const resposta = await chamar('GET', `/api/lotes/${'a'.repeat(101)}`);

    expect(resposta.status).toBe(414);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS' } });
    esperarCabecalhosDeSeguranca(resposta);
  });
});

// Em produção o Caddy (infra/caddy/Caddyfile) já põe os quatro, e o reverse_proxy soma os do
// upstream: se a API também os mandasse, cada um sairia duas vezes (COOP duplicado é inválido).
describe('cabeçalhos de segurança em produção (revisão da 020)', () => {
  let appDeProducao: NestFastifyApplication;
  let portaDeProducao: number;

  beforeAll(async () => {
    appDeProducao = await criarApi({
      ...ENV_DE_TESTE,
      WEB_ORIGIN: 'https://leilao.exemplo.com',
      cookiesSeguros: true,
      producao: true,
    });
    await appDeProducao.listen(0, '127.0.0.1');
    portaDeProducao = (appDeProducao.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await appDeProducao.close();
  });

  function esperarSemCabecalhosDeSeguranca(resposta: Resposta): void {
    for (const nome of Object.keys(CABECALHOS_DE_SEGURANCA)) {
      expect(resposta.cabecalhos[nome], nome).toBeUndefined();
    }
  }

  it.each([
    ['/api/health/live', 200],
    ['/api/nao-existe', 404],
  ])('não saem em %s (%i), e o x-request-id continua', async (caminho, status) => {
    const resposta = await chamar('GET', caminho, {}, undefined, portaDeProducao);

    expect(resposta.status).toBe(status);
    esperarSemCabecalhosDeSeguranca(resposta);
    expect(resposta.cabecalhos['x-request-id']).toMatch(UUID);
  });

  // O 400/414 do roteador sai antes dos hooks `onRequest` (frameworkErrors em app.ts), então nunca
  // levou x-request-id, dentro ou fora de produção.
  it.each([
    ['/api/lotes/%E0%A4%A', 400],
    [`/api/lotes/${'a'.repeat(101)}`, 414],
  ])('não saem no erro do roteador em %s (%i)', async (caminho, status) => {
    const resposta = await chamar('GET', caminho, {}, undefined, portaDeProducao);

    expect(resposta.status).toBe(status);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS' } });
    esperarSemCabecalhosDeSeguranca(resposta);
  });
});

describe('x-request-id (tarefa 020)', () => {
  it('devolve o UUID gerado pelo servidor e ignora o enviado pelo cliente', async () => {
    const resposta = await chamar('GET', '/api/health/live', {
      'x-request-id': 'forjado',
      'request-id': 'forjado',
    });

    expect(resposta.cabecalhos['x-request-id']).toMatch(UUID);
    const outra = await chamar('GET', '/api/health/live');
    expect(outra.cabecalhos['x-request-id']).toMatch(UUID);
    expect(outra.cabecalhos['x-request-id']).not.toBe(resposta.cabecalhos['x-request-id']);
  });
});

describe('origem nas rotas que mudam estado (tarefa 020)', () => {
  it('recusa POST com Origin diferente de WEB_ORIGIN: 403 CSRF_INVALIDO no envelope', async () => {
    const resposta = await postJson('{}', ORIGEM_ESTRANHA);

    expect(resposta.status).toBe(403);
    expect(JSON.parse(resposta.corpo)).toEqual({
      sucesso: false,
      erro: { codigo: 'CSRF_INVALIDO', mensagem: expect.any(String) },
    });
    esperarCabecalhosDeSeguranca(resposta);
    esperarSemCors(resposta);
  });

  it.each(['null', `${ORIGEM_DA_SPA}.exemplo.com`, `${ORIGEM_DA_SPA}, ${ORIGEM_ESTRANHA}`])(
    'recusa Origin=%j',
    async (origem) => {
      expect((await postJson('{}', origem)).status).toBe(403);
    },
  );

  it('aceita POST da própria SPA e sem Origin (segue para a validação: 422)', async () => {
    for (const origem of [ORIGEM_DA_SPA, undefined]) {
      const resposta = await postJson('{}', origem);
      expect(resposta.status, String(origem)).toBe(422);
      esperarSemCors(resposta);
    }
  });

  it('GET de outra origem não é recusado e não recebe access-control-allow-*', async () => {
    const resposta = await chamar('GET', '/api/health/live', { origin: ORIGEM_ESTRANHA });

    expect(resposta.status).toBe(200);
    esperarSemCors(resposta);
  });

  it('preflight OPTIONS de outra origem não libera CORS', async () => {
    const resposta = await chamar('OPTIONS', '/api/auth/login', {
      origin: ORIGEM_ESTRANHA,
      'access-control-request-method': 'POST',
    });

    expect(resposta.status).toBeGreaterThanOrEqual(400);
    esperarSemCors(resposta);
  });
});

describe('limites HTTP explícitos (tarefa 020)', () => {
  it('corpo JSON acima do limite → 413 DADOS_INVALIDOS no envelope', async () => {
    const corpo = JSON.stringify({ email: 'x'.repeat(LIMITE_DO_CORPO_BYTES) });

    const resposta = await postJson(corpo, ORIGEM_DA_SPA);

    expect(resposta.status).toBe(413);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS' } });
  });

  it('o servidor HTTP usa os timeouts declarados', () => {
    const servidor = app.getHttpServer();

    expect(servidor.keepAliveTimeout).toBe(TIMEOUTS_HTTP.keepAliveMs);
    expect(servidor.requestTimeout).toBe(TIMEOUTS_HTTP.requisicaoMs);
    expect(servidor.headersTimeout).toBe(TIMEOUTS_HTTP.cabecalhosMs);
    expect(servidor.timeout).toBe(TIMEOUTS_HTTP.conexaoOciosaMs);
  });

  it('keep-alive da API passa do keepalive de 2 min do Caddy (evita 502 no reuso)', () => {
    expect(TIMEOUTS_HTTP.keepAliveMs).toBeGreaterThan(120_000);
    expect(TIMEOUTS_HTTP.cabecalhosMs).toBeLessThanOrEqual(TIMEOUTS_HTTP.requisicaoMs);
  });
});
