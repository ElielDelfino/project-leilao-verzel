// Gênese, canônico e hash do lance e do selo (specs/008 §Técnica e §Forma canônica e vetor de teste).
import { createHash } from 'node:crypto';

import { canonicalizar, ErroDeCanonico } from './canonico.js';

/** Campos assinados de um lance (specs/008 §Forma canônica, "Lance"). */
export interface DadosDoLance {
  readonly loteId: string;
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: string;
  readonly hashAnterior: string;
}

export type StatusDoSelo = 'encerrado' | 'cancelado';

/** Campos assinados do selo (specs/008 §Forma canônica, "Selo"). */
export interface DadosDoSelo {
  readonly loteId: string;
  readonly status: StatusDoSelo;
  readonly totalLances: number;
  readonly hashFinal: string;
  readonly vencedorPseudonimo: string | null;
  readonly valorArremateCentavos: number | null;
  readonly seladoEm: string;
}

const PREFIXO_DA_GENESE = 'leilao-verzel:genesis:';
const UUID_MINUSCULO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
// Forma de Date.prototype.toISOString: UTC, exatamente 3 casas de milissegundo e Z.
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STATUS_DO_SELO: readonly string[] = ['encerrado', 'cancelado'];

function exigir(condicao: boolean, mensagem: string): void {
  if (!condicao) throw new ErroDeCanonico(mensagem);
}

function exigirLoteId(loteId: string): void {
  exigir(UUID_MINUSCULO.test(loteId), 'campo loteId: não é UUID em minúsculas');
}

function exigirInteiro(chave: string, valor: number, minimo: number): void {
  exigir(Number.isSafeInteger(valor) && valor >= minimo, `campo ${chave}: inteiro inválido`);
}

function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** `hashAnterior` do lance 1: SHA-256("leilao-verzel:genesis:" + loteId) em hex minúsculo. */
export function hashGenese(loteId: string): string {
  exigirLoteId(loteId);
  return sha256Hex(PREFIXO_DA_GENESE + loteId);
}

/** Canônico do lance com só as 6 chaves da spec; lança {@link ErroDeCanonico} fora do formato. */
export function canonicoDoLance(lance: DadosDoLance): string {
  exigirLoteId(lance.loteId);
  exigirInteiro('seq', lance.seq, 1);
  exigir(
    HEX_64.test(lance.hashAnterior),
    'campo hashAnterior: não é hex minúsculo de 64 caracteres',
  );
  exigir(
    INSTANTE_ISO.test(lance.criadoEm),
    'campo criadoEm: fora do formato ISO 8601 com milissegundos',
  );
  return canonicalizar({
    criadoEm: lance.criadoEm,
    hashAnterior: lance.hashAnterior,
    loteId: lance.loteId,
    pseudonimo: lance.pseudonimo,
    seq: lance.seq,
    valorCentavos: lance.valorCentavos,
  });
}

/** `hash` do lance: SHA-256 do canônico em UTF-8, hex minúsculo. */
export function hashDoLance(lance: DadosDoLance): string {
  return sha256Hex(canonicoDoLance(lance));
}

/** Canônico do selo com as 7 chaves da spec (null mantém a chave); lança {@link ErroDeCanonico}. */
export function canonicoDoSelo(selo: DadosDoSelo): string {
  exigirLoteId(selo.loteId);
  exigir(STATUS_DO_SELO.includes(selo.status), 'campo status: valor desconhecido');
  exigirInteiro('totalLances', selo.totalLances, 0);
  exigir(HEX_64.test(selo.hashFinal), 'campo hashFinal: não é hex minúsculo de 64 caracteres');
  exigir(
    INSTANTE_ISO.test(selo.seladoEm),
    'campo seladoEm: fora do formato ISO 8601 com milissegundos',
  );
  return canonicalizar({
    hashFinal: selo.hashFinal,
    loteId: selo.loteId,
    seladoEm: selo.seladoEm,
    status: selo.status,
    totalLances: selo.totalLances,
    valorArremateCentavos: selo.valorArremateCentavos,
    vencedorPseudonimo: selo.vencedorPseudonimo,
  });
}

/** Hash do selo: SHA-256 do canônico em UTF-8, hex minúsculo (é o que a assinatura cobre). */
export function hashDoSelo(selo: DadosDoSelo): string {
  return sha256Hex(canonicoDoSelo(selo));
}
