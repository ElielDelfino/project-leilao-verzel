// Download da imagem `normal` do snapshot (specs/005 §Snapshot). Defesa contra SSRF: só https na
// porta 443 em `scryfall.io` ou `*.scryfall.io` (hostname, nunca IP literal), mais a origem exata
// de SCRYFALL_BASE_URL quando sobrescrita (teste e e2e). Sem seguir redirecionamento, com teto de
// 1 MB lido em streaming e tipo confirmado por Content-Type e magic bytes. Não consome ficha do
// bucket (imagens da Scryfall não têm limite).
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import type { MIMES_DE_IMAGEM } from './schema.js';

export type MimeDeImagem = (typeof MIMES_DE_IMAGEM)[number];

/** 1 MB (specs/005): exatamente esse tamanho é aceito; um byte a mais, não. */
export const LIMITE_DA_IMAGEM_BYTES = 1_048_576;
const TIMEOUT_PADRAO_MS = 3_000;
const HTTP_OK = 200;
const DOMINIO = 'scryfall.io';

const MAGIC_BYTES: Readonly<Record<MimeDeImagem, readonly number[]>> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export interface ImagemBaixada {
  readonly bytes: Buffer;
  readonly mime: MimeDeImagem;
  /** SHA-256 dos bytes (32 bytes). */
  readonly sha256: Buffer;
}

export interface OpcoesDoDownload {
  readonly userAgent: string;
  /** Origem extra aceita (`esquema://host[:porta]`), só com SCRYFALL_BASE_URL sobrescrita. */
  readonly origemExtra?: string;
  readonly timeoutMs?: number;
}

/** Motivo da recusa, para o log (nunca leva a URL nem o corpo). */
export type MotivoDaRecusa =
  | 'url_invalida'
  | 'fora_da_allowlist'
  | 'falha_de_rede'
  | 'status'
  | 'content_type'
  | 'grande_demais'
  | 'magic_bytes';

export class RecusaDaImagem extends Error {
  override readonly name = 'RecusaDaImagem';
  readonly motivo: MotivoDaRecusa;

  constructor(motivo: MotivoDaRecusa) {
    super(`imagem recusada: ${motivo}`);
    this.motivo = motivo;
  }
}

function hostDaScryfall(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    isIP(host) === 0 &&
    (host === DOMINIO || host.endsWith(`.${DOMINIO}`))
  );
}

/** URL aceita para o download: `*.scryfall.io` em https:443, ou a origem extra exata. */
export function urlPermitida(texto: string, origemExtra?: string): boolean {
  if (!URL.canParse(texto)) return false;
  const url = new URL(texto);
  if (url.username !== '' || url.password !== '') return false;
  if (origemExtra !== undefined && url.origin === origemExtra) return true;
  return hostDaScryfall(url);
}

function mimeDoCabecalho(valor: string | null): MimeDeImagem | undefined {
  const mime = (valor ?? '').split(';')[0]?.trim().toLowerCase();
  return mime === 'image/jpeg' || mime === 'image/png' ? mime : undefined;
}

function comecaCom(bytes: Buffer, assinatura: readonly number[]): boolean {
  return bytes.length >= assinatura.length && assinatura.every((b, i) => bytes[i] === b);
}

/** Lê o corpo em streaming e aborta assim que passar do limite (chunked sem content-length). */
async function lerComTeto(resposta: Response): Promise<Buffer> {
  const declarado = Number(resposta.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declarado) && declarado > LIMITE_DA_IMAGEM_BYTES) {
    await resposta.body?.cancel();
    throw new RecusaDaImagem('grande_demais');
  }
  const leitor = resposta.body?.getReader();
  if (leitor === undefined) return Buffer.alloc(0);
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE_DA_IMAGEM_BYTES) {
      await leitor.cancel();
      throw new RecusaDaImagem('grande_demais');
    }
    partes.push(value);
  }
  return Buffer.concat(partes, total);
}

async function requisitar(url: string, opcoes: OpcoesDoDownload): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { 'User-Agent': opcoes.userAgent, Accept: 'image/jpeg, image/png' },
      redirect: 'manual',
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS),
    });
  } catch {
    // A mensagem do fetch leva a URL; o motivo basta para o log.
    throw new RecusaDaImagem('falha_de_rede');
  }
}

/** Baixa e confere a imagem; qualquer recusa lança RecusaDaImagem. */
export async function baixarImagem(url: string, opcoes: OpcoesDoDownload): Promise<ImagemBaixada> {
  if (!URL.canParse(url)) throw new RecusaDaImagem('url_invalida');
  if (!urlPermitida(url, opcoes.origemExtra)) throw new RecusaDaImagem('fora_da_allowlist');
  const resposta = await requisitar(url, opcoes);
  if (resposta.status !== HTTP_OK) {
    await resposta.body?.cancel();
    throw new RecusaDaImagem('status');
  }
  const mime = mimeDoCabecalho(resposta.headers.get('content-type'));
  if (mime === undefined) {
    await resposta.body?.cancel();
    throw new RecusaDaImagem('content_type');
  }
  let bytes: Buffer;
  try {
    bytes = await lerComTeto(resposta);
  } catch (erro: unknown) {
    if (erro instanceof RecusaDaImagem) throw erro;
    throw new RecusaDaImagem('falha_de_rede');
  }
  if (!comecaCom(bytes, MAGIC_BYTES[mime])) throw new RecusaDaImagem('magic_bytes');
  return { bytes, mime, sha256: createHash('sha256').update(bytes).digest() };
}
