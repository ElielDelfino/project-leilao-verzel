// Forma canônica, hash e codificações (specs/008 §Forma canônica e vetor de teste), a mesma da API.
import { ErroDeContextoInseguro } from './tipos';

export class ErroDeCanonico extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeCanonico';
  }
}

export type ValorCanonico = string | number | null;

const ASCII = /^\p{ASCII}*$/u;
const UUID_MINUSCULO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;
const PREFIXO_DA_GENESE = 'leilao-verzel:genesis:';

function exigir(condicao: boolean, mensagem: string): void {
  if (!condicao) throw new ErroDeCanonico(mensagem);
}

/** Chaves em ordem alfabética (UTF-16), sem espaços; só strings ASCII, inteiros seguros e null. */
export function canonicalizar(objeto: Readonly<Record<string, ValorCanonico>>): string {
  const membros = Object.keys(objeto)
    .sort()
    .map((chave) => {
      const valor = objeto[chave] as unknown;
      exigir(ASCII.test(chave), 'chave fora do ASCII');
      const valido =
        valor === null ||
        (typeof valor === 'string' && ASCII.test(valor)) ||
        (typeof valor === 'number' && Number.isSafeInteger(valor));
      exigir(valido, `campo ${chave}: fora da forma canônica`);
      return `${JSON.stringify(chave)}:${JSON.stringify(valor)}`;
    });
  return `{${membros.join(',')}}`;
}

export function exigirLoteId(loteId: string): void {
  exigir(UUID_MINUSCULO.test(loteId), 'campo loteId: não é UUID em minúsculas');
}

export function exigirHex64(chave: string, valor: string): void {
  exigir(HEX_64.test(valor), `campo ${chave}: não é hex minúsculo de 64 caracteres`);
}

export function exigirInstante(chave: string, valor: string): void {
  exigir(INSTANTE_ISO.test(valor), `campo ${chave}: fora do formato ISO 8601`);
}

export function exigirInteiro(chave: string, valor: number, minimo: number): void {
  exigir(Number.isSafeInteger(valor) && valor >= minimo, `campo ${chave}: inteiro inválido`);
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (s === undefined) throw new ErroDeContextoInseguro();
  return s;
}

export function paraHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deHex(hex: string): Uint8Array {
  exigirHex64('hex', hex);
  return Uint8Array.from(hex.match(/../g) ?? [], (par) => Number.parseInt(par, 16));
}

/** Decodifica base64url só na forma canônica (recodificar reproduz o texto); `null` se não for. */
export function deBase64Url(texto: string): Uint8Array | null {
  if (!BASE64URL.test(texto) || texto.length % 4 === 1) return null;
  try {
    const padded = texto
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(texto.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return paraBase64Url(bytes) === texto ? bytes : null;
  } catch {
    return null;
  }
}

export function paraBase64Url(bytes: Uint8Array): string {
  const binario = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 em bytes (WebCrypto). Lança `ErroDeContextoInseguro` sem `crypto.subtle`. */
export async function sha256(dados: Uint8Array): Promise<Uint8Array> {
  const copia = new Uint8Array(dados);
  return new Uint8Array(await subtle().digest('SHA-256', copia));
}

export async function sha256DoTexto(texto: string): Promise<string> {
  return paraHex(await sha256(new TextEncoder().encode(texto)));
}

/** `hashAnterior` do lance 1. */
export async function hashGenese(loteId: string): Promise<string> {
  exigirLoteId(loteId);
  return sha256DoTexto(PREFIXO_DA_GENESE + loteId);
}

/** `keyId`: 16 primeiros hex de SHA-256 da chave pública (specs/008 §Chaves). */
export async function keyIdDaChave(chavePublica: Uint8Array): Promise<string> {
  return paraHex(await sha256(chavePublica)).slice(0, 16);
}
