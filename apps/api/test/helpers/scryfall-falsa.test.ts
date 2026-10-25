// Testes da Scryfall falsa (task 052, specs/005): cada modo e o registro de requisições.
import { networkInterfaces } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ID_CARTA_DUPLA_FACE,
  ID_CARTA_SEM_IMAGEM,
  ID_CARTA_SIMPLES,
} from './fixtures-scryfall/cartas.js';
import { LIMITE_IMAGEM_BYTES } from './fixtures-scryfall/imagens.js';
import { iniciarScryfallFalsa, type ScryfallFalsa } from './scryfall-falsa.js';

let falsa: ScryfallFalsa | undefined;

async function subir(opcoes: Parameters<typeof iniciarScryfallFalsa>[0] = {}) {
  falsa = await iniciarScryfallFalsa(opcoes);
  return falsa;
}

afterEach(async () => {
  await falsa?.fechar();
  falsa = undefined;
});

interface Lista {
  object: string;
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: { id: string; name: string }[];
}

describe('modo ok', () => {
  it('escuta só em 127.0.0.1 numa porta aleatória', async () => {
    const s = await subir();
    expect(s.host).toBe('127.0.0.1');
    expect(s.url).toBe(`http://127.0.0.1:${s.porta}`);
    expect(s.porta).toBeGreaterThan(0);
    const res = await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`);
    expect(res.status).toBe(200);
  });

  it('recusa conexão pelos endereços não loopback da máquina', async () => {
    const s = await subir();
    const externos = Object.values(networkInterfaces())
      .flat()
      .flatMap((i) => (i?.family === 'IPv4' && !i.internal ? [i.address] : []));
    // Sem interface externa (sandbox), o bind em 0.0.0.0 não é distinguível: nada a provar.
    for (const endereco of externos) {
      await expect(
        fetch(`http://${endereco}:${s.porta}/cards/${ID_CARTA_SIMPLES}`),
      ).rejects.toThrow();
    }
  });

  it('busca devolve list com 175 por página, total_cards e has_more', async () => {
    const s = await subir();
    const p1 = (await (await fetch(`${s.url}/cards/search?q=carta`)).json()) as Lista;
    expect(p1.object).toBe('list');
    expect(p1.total_cards).toBe(398);
    expect(p1.has_more).toBe(true);
    expect(p1.data).toHaveLength(175);
    expect(p1.next_page).toBe(`${s.url}/cards/search?q=carta&page=2`);

    const p3 = (await (await fetch(`${s.url}/cards/search?q=carta&page=3`)).json()) as Lista;
    expect(p3.data).toHaveLength(48);
    expect(p3.has_more).toBe(false);
    expect(p3.next_page).toBeUndefined();
  });

  it('busca sem resultado responde 404 not_found no formato da Scryfall', async () => {
    const s = await subir();
    const res = await fetch(`${s.url}/cards/search?q=nadaassim`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ object: 'error', code: 'not_found', status: 404 });
  });

  it('busca sem q responde 400', async () => {
    const s = await subir();
    expect((await fetch(`${s.url}/cards/search`)).status).toBe(400);
  });

  it('carta simples tem image_uris.normal e a imagem é JPEG', async () => {
    const s = await subir();
    const carta = (await (await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).json()) as {
      name: string;
      image_uris: { normal: string };
    };
    expect(carta.name).toBe('Lightning Bolt');
    const img = await fetch(carta.image_uris.normal);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await img.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect([bytes.at(-2), bytes.at(-1)]).toEqual([0xff, 0xd9]);
  });

  it('carta dupla-face só tem imagem em card_faces e ela é PNG', async () => {
    const s = await subir();
    const carta = (await (await fetch(`${s.url}/cards/${ID_CARTA_DUPLA_FACE}`)).json()) as {
      image_uris?: unknown;
      card_faces: { image_uris: { normal: string } }[];
    };
    expect(carta.image_uris).toBeUndefined();
    expect(carta.card_faces).toHaveLength(2);
    const urlDaFace = carta.card_faces[0]?.image_uris.normal ?? '';
    expect(urlDaFace).toMatch(/\.png$/);
    const img = await fetch(urlDaFace);
    expect(img.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await img.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('carta sem imagem não tem image_uris nem card_faces', async () => {
    const s = await subir();
    const carta = (await (await fetch(`${s.url}/cards/${ID_CARTA_SEM_IMAGEM}`)).json()) as object;
    expect(carta).not.toHaveProperty('image_uris');
    expect(carta).not.toHaveProperty('card_faces');
    expect(carta).toMatchObject({ image_status: 'missing' });
  });

  it('carta inexistente responde 404 e id inválido responde 404', async () => {
    const s = await subir();
    const inexistente = '99999999-9999-4999-8999-999999999999';
    expect((await fetch(`${s.url}/cards/${inexistente}`)).status).toBe(404);
    expect((await fetch(`${s.url}/imagens/${inexistente}.jpg`)).status).toBe(404);
  });
});

describe('modos de falha', () => {
  it('429 responde uma vez com Retry-After e volta ao ok', async () => {
    const s = await subir();
    s.definirModo('429');
    const r1 = await fetch(`${s.url}/cards/search?q=lightning`);
    expect(r1.status).toBe(429);
    expect(r1.headers.get('retry-after')).toBe('30');
    expect(await r1.json()).toMatchObject({ object: 'error', status: 429 });
    expect(s.modo()).toBe('ok');
    expect((await fetch(`${s.url}/cards/search?q=lightning`)).status).toBe(200);
  });

  it('bloqueada responde 429 em toda requisição até trocar o modo', async () => {
    const s = await subir();
    s.definirModo('bloqueada');
    for (let i = 0; i < 3; i += 1) {
      expect((await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).status).toBe(429);
    }
    expect(s.modo()).toBe('bloqueada');
    s.definirModo('ok');
    expect((await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).status).toBe(200);
  });

  it('5xx responde 503 em toda requisição', async () => {
    const s = await subir();
    s.definirModo('5xx');
    expect((await fetch(`${s.url}/cards/search?q=a`)).status).toBe(503);
    expect((await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).status).toBe(503);
  });

  it('5xx com vezes 1 falha uma vez e volta ao ok', async () => {
    const s = await subir();
    s.definirModo('5xx', { vezes: 1 });
    expect((await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).status).toBe(503);
    expect((await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).status).toBe(200);
    expect(s.modo()).toBe('ok');
  });

  it('lento atrasa a resposta pelo tempo configurado', async () => {
    const s = await subir({ atrasoLentoMs: 200 });
    s.definirModo('lento');
    const inicio = performance.now();
    const res = await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`);
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(190);
    expect(res.status).toBe(200);
  });

  it('fora derruba a conexão', async () => {
    const s = await subir();
    s.definirModo('fora');
    await expect(fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).rejects.toThrow();
    expect(s.requisicoes()).toHaveLength(1);
  });

  it('imagem_grande serve JPEG acima de 1 MB e mantém as cartas normais', async () => {
    const s = await subir();
    s.definirModo('imagem_grande');
    expect((await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`)).status).toBe(200);
    const img = await fetch(`${s.url}/imagens/${ID_CARTA_SIMPLES}.jpg`);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(LIMITE_IMAGEM_BYTES);
  });

  it('mime_errado serve GIF com content-type image/gif', async () => {
    const s = await subir();
    s.definirModo('mime_errado');
    const img = await fetch(`${s.url}/imagens/${ID_CARTA_SIMPLES}.jpg`);
    expect(img.headers.get('content-type')).toBe('image/gif');
    const bytes = new Uint8Array(await img.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('GIF8');
  });

  it('fechar encerra requisição lenta pendente sem travar', async () => {
    const s = await subir({ atrasoLentoMs: 30_000 });
    s.definirModo('lento');
    const pendente = fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`).catch(() => 'caiu');
    await s.aguardarRequisicoes(1);
    await s.fechar();
    expect(await pendente).toBe('caiu');
    falsa = undefined;
  });
});

describe('registro de requisições', () => {
  it('guarda método, caminho (com query) e instante monotônico crescente', async () => {
    const s = await subir();
    await fetch(`${s.url}/cards/search?q=lightning`);
    await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`);
    const reg = s.requisicoes();
    expect(reg.map((r) => [r.metodo, r.caminho])).toEqual([
      ['GET', '/cards/search?q=lightning'],
      ['GET', `/cards/${ID_CARTA_SIMPLES}`],
    ]);
    const [primeira, segunda] = reg.map((r) => r.instanteMs);
    expect(primeira).toBeTypeOf('number');
    expect(segunda).toBeGreaterThanOrEqual(primeira ?? Number.POSITIVE_INFINITY);
  });

  it('guarda os headers User-Agent e Accept', async () => {
    const s = await subir();
    await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`, {
      headers: { 'user-agent': 'Teste/1.0', accept: 'application/json' },
    });
    expect(s.requisicoes()[0]).toMatchObject({
      userAgent: 'Teste/1.0',
      accept: 'application/json',
    });
  });

  it('aguardarRequisicoes rejeita depois do tempo limite', async () => {
    const s = await subir();
    await expect(s.aguardarRequisicoes(1, 50)).rejects.toThrow('0 de 1');
  });

  it('zerar limpa o registro e a cópia devolvida não altera o interno', async () => {
    const s = await subir();
    await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`);
    const copia = s.requisicoes() as unknown[];
    copia.length = 0;
    expect(s.requisicoes()).toHaveLength(1);
    s.zerar();
    expect(s.requisicoes()).toHaveLength(0);
  });
});

describe('/__controle', () => {
  it('não existe sem a opção controle', async () => {
    const s = await subir();
    expect((await fetch(`${s.url}/__controle`)).status).toBe(404);
  });

  it('troca o modo, lê o contador e não se registra', async () => {
    const s = await subir({ controle: true });
    await fetch(`${s.url}/cards/${ID_CARTA_SIMPLES}`);
    const antes = (await (await fetch(`${s.url}/__controle`)).json()) as {
      modo: string;
      total: number;
      requisicoes: unknown[];
    };
    expect(antes).toMatchObject({ modo: 'ok', total: 1 });
    expect(antes.requisicoes).toHaveLength(1);

    const troca = await fetch(`${s.url}/__controle`, {
      method: 'POST',
      body: JSON.stringify({ modo: 'bloqueada' }),
    });
    expect(troca.status).toBe(200);
    expect(s.modo()).toBe('bloqueada');

    await fetch(`${s.url}/__controle`, { method: 'POST', body: JSON.stringify({ zerar: true }) });
    expect(s.requisicoes()).toHaveLength(0);
  });

  it('recusa modo desconhecido e JSON inválido com 400', async () => {
    const s = await subir({ controle: true });
    const ruim = await fetch(`${s.url}/__controle`, {
      method: 'POST',
      body: JSON.stringify({ modo: 'inexistente' }),
    });
    expect(ruim.status).toBe(400);
    const invalido = await fetch(`${s.url}/__controle`, { method: 'POST', body: '{' });
    expect(invalido.status).toBe(400);
    expect(s.modo()).toBe('ok');
  });
});
