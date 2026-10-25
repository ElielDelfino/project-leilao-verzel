// Download da imagem do snapshot (specs/005 §Snapshot; notas das revisões da 049 e da 052):
// allowlist de host, teto de 1 MB em streaming, Content-Type e magic bytes. Um servidor node:http
// local faz o papel da origem sobrescrita (SCRYFALL_BASE_URL) e serve cada caso por caminho.
import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  baixarImagem,
  LIMITE_DA_IMAGEM_BYTES,
  RecusaDaImagem,
  urlPermitida,
} from '../../../src/modules/catalogo/download-de-imagem.js';
import {
  GIF_MINIMO,
  JPEG_MINIMO,
  jpegDeTamanho,
  PNG_MINIMO,
} from '../../helpers/fixtures-scryfall/imagens.js';

const PEDACO = 64 * 1024;

/** Envia em chunked (sem content-length), em pedaços. */
function chunked(res: ServerResponse, tipo: string, bytes: Buffer): void {
  res.writeHead(200, { 'content-type': tipo, 'transfer-encoding': 'chunked' });
  for (let i = 0; i < bytes.length; i += PEDACO) res.write(bytes.subarray(i, i + PEDACO));
  res.end();
}

const ROTAS: Readonly<Record<string, (res: ServerResponse) => void>> = {
  '/jpeg': (res) => res.writeHead(200, { 'content-type': 'image/jpeg' }).end(JPEG_MINIMO),
  '/png': (res) =>
    res.writeHead(200, { 'content-type': 'image/png; charset=binary' }).end(PNG_MINIMO),
  '/gif': (res) => res.writeHead(200, { 'content-type': 'image/gif' }).end(GIF_MINIMO),
  '/gif-como-jpeg': (res) => res.writeHead(200, { 'content-type': 'image/jpeg' }).end(GIF_MINIMO),
  '/png-como-jpeg': (res) => res.writeHead(200, { 'content-type': 'image/jpeg' }).end(PNG_MINIMO),
  '/sem-tipo': (res) => res.writeHead(200).end(JPEG_MINIMO),
  '/limite': (res) => chunked(res, 'image/jpeg', jpegDeTamanho(LIMITE_DA_IMAGEM_BYTES)),
  '/limite-mais-um': (res) => chunked(res, 'image/jpeg', jpegDeTamanho(LIMITE_DA_IMAGEM_BYTES + 1)),
  '/declarado-grande': (res) => {
    const bytes = jpegDeTamanho(LIMITE_DA_IMAGEM_BYTES + 1);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': bytes.length });
    res.end(bytes);
  },
  '/redireciona': (res) => res.writeHead(302, { location: '/jpeg' }).end(),
  '/lenta': () => undefined,
};

let servidor: Server;
let origem = '';

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const rota = ROTAS[req.url ?? ''];
    if (rota === undefined) return void res.writeHead(404).end();
    rota(res);
  });
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === 'string') throw new Error('endereço inesperado');
  origem = `http://127.0.0.1:${endereco.port}`;
});

afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
});

function baixar(caminho: string, timeoutMs?: number): ReturnType<typeof baixarImagem> {
  return baixarImagem(`${origem}${caminho}`, {
    userAgent: 'LeilaoVerzel/teste',
    origemExtra: origem,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function motivo(promessa: Promise<unknown>): Promise<string> {
  const erro: unknown = await promessa.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(RecusaDaImagem);
  return (erro as RecusaDaImagem).motivo;
}

describe('urlPermitida', () => {
  it.each([
    'https://cards.scryfall.io/normal/front/a/b/x.jpg',
    'https://scryfall.io/x.jpg',
    'https://c1.scryfall.io/x.png',
    'https://CARDS.Scryfall.IO/x.jpg',
    'https://cards.scryfall.io:443/x.jpg',
  ])('aceita %s', (url) => {
    expect(urlPermitida(url)).toBe(true);
  });

  it.each([
    ['http (sem TLS)', 'http://cards.scryfall.io/x.jpg'],
    ['sufixo sem o ponto', 'https://evilscryfall.io/x.jpg'],
    ['domínio que só contém scryfall.io', 'https://cards.scryfall.io.evil.com/x.jpg'],
    ['outra porta', 'https://cards.scryfall.io:8443/x.jpg'],
    ['IPv4 literal', 'https://1.2.3.4/x.jpg'],
    ['IPv6 literal', 'https://[::1]/x.jpg'],
    ['credenciais na URL', 'https://u:s@cards.scryfall.io/x.jpg'],
    ['api.scryfall.com sem sobrescrita', 'https://api.scryfall.com/x.jpg'],
    ['esquema estranho', 'file:///etc/passwd'],
    ['texto que não é URL', 'nada'],
  ])('recusa %s', (_caso, url) => {
    expect(urlPermitida(url)).toBe(false);
  });

  it('aceita a origem extra só na origem exata (esquema, host e porta)', () => {
    const extra = 'http://127.0.0.1:4010';
    expect(urlPermitida('http://127.0.0.1:4010/imagens/x.jpg', extra)).toBe(true);
    expect(urlPermitida('http://127.0.0.1:4011/imagens/x.jpg', extra)).toBe(false);
    expect(urlPermitida('https://127.0.0.1:4010/imagens/x.jpg', extra)).toBe(false);
    expect(urlPermitida('http://127.0.0.1:4010/imagens/x.jpg')).toBe(false);
  });
});

describe('baixarImagem', () => {
  it('JPEG: devolve os bytes, o tipo e o SHA-256', async () => {
    const imagem = await baixar('/jpeg');
    expect(imagem.mime).toBe('image/jpeg');
    expect(imagem.bytes.equals(JPEG_MINIMO)).toBe(true);
    expect(imagem.sha256.equals(createHash('sha256').update(JPEG_MINIMO).digest())).toBe(true);
  });

  it('PNG com parâmetro no Content-Type', async () => {
    const imagem = await baixar('/png');
    expect(imagem.mime).toBe('image/png');
    expect(imagem.bytes.equals(PNG_MINIMO)).toBe(true);
  });

  it('aceita exatamente 1 048 576 bytes em chunked', async () => {
    const imagem = await baixar('/limite');
    expect(imagem.bytes.length).toBe(LIMITE_DA_IMAGEM_BYTES);
  });

  it.each([
    ['um byte acima do limite em chunked, sem content-length', '/limite-mais-um', 'grande_demais'],
    ['content-length acima do limite', '/declarado-grande', 'grande_demais'],
    ['Content-Type GIF', '/gif', 'content_type'],
    ['sem Content-Type', '/sem-tipo', 'content_type'],
    ['image/jpeg com bytes GIF', '/gif-como-jpeg', 'magic_bytes'],
    ['image/jpeg com bytes PNG', '/png-como-jpeg', 'magic_bytes'],
    ['redirecionamento (não é seguido)', '/redireciona', 'status'],
    ['404', '/inexistente', 'status'],
  ])('recusa %s', async (_caso, caminho, esperado) => {
    expect(await motivo(baixar(caminho))).toBe(esperado);
  });

  it('timeout vira falha de rede', async () => {
    expect(await motivo(baixar('/lenta', 50))).toBe('falha_de_rede');
  });

  it('host fora da allowlist é recusado sem requisição', async () => {
    const promessa = baixarImagem('https://evilscryfall.io/x.jpg', { userAgent: 'x' });
    expect(await motivo(promessa)).toBe('fora_da_allowlist');
  });
});
