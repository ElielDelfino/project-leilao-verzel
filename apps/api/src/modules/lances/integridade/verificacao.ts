// Verificação da cadeia de um lote: os 5 passos de specs/008 §Verificação, sem I/O.
import { verificar } from './assinatura.js';
import { ErroDeCanonico } from './canonico.js';
import {
  type DadosDoLance,
  type DadosDoSelo,
  hashDoLance,
  hashDoSelo,
  hashGenese,
} from './hash.js';

/** Lance como gravado em `bids` (o `loteId` vem da entrada da verificação). */
export interface LanceRegistrado extends Omit<DadosDoLance, 'loteId'> {
  readonly hash: string;
  readonly assinatura: string;
  readonly keyId: string;
}

/** Selo como gravado em `lot_seals`. */
export interface SeloRegistrado extends Omit<DadosDoSelo, 'loteId'> {
  readonly assinatura: string;
  readonly keyId: string;
}

/** Linha de `signing_keys`. */
export interface ChavePublicada {
  readonly keyId: string;
  readonly chavePublica: Uint8Array;
}

export type CodigoDoProblema =
  | 'SEQ_FORA_DE_ORDEM'
  | 'HASH_ANTERIOR_DIVERGENTE'
  | 'HASH_DIVERGENTE'
  | 'ASSINATURA_INVALIDA'
  | 'CHAVE_DESCONHECIDA'
  | 'SELO_TOTAL_DIVERGENTE'
  | 'SELO_HASH_FINAL_DIVERGENTE'
  | 'SELO_ASSINATURA_INVALIDA';

/** Problema encontrado; `seq` é `null` nos problemas do selo. */
export interface Problema {
  readonly codigo: CodigoDoProblema;
  readonly seq: number | null;
  readonly mensagem: string;
}

export interface ResultadoDaVerificacao {
  readonly veredito: 'integro' | 'adulterado';
  readonly problemas: readonly Problema[];
}

export interface EntradaDaVerificacao {
  readonly loteId: string;
  /** Lances na ordem em que estão gravados (por `seq` crescente). */
  readonly lances: readonly LanceRegistrado[];
  readonly selo: SeloRegistrado | null;
  readonly chaves: readonly ChavePublicada[];
}

const MENSAGENS: Readonly<Record<CodigoDoProblema, string>> = {
  SEQ_FORA_DE_ORDEM: 'A sequência dos lances não é contígua a partir de 1.',
  HASH_ANTERIOR_DIVERGENTE: 'O hash anterior não é o hash do lance anterior.',
  HASH_DIVERGENTE: 'O hash não corresponde aos dados do lance.',
  ASSINATURA_INVALIDA: 'A assinatura do lance não confere com a chave publicada.',
  CHAVE_DESCONHECIDA: 'O lance foi assinado com uma chave que não está publicada.',
  SELO_TOTAL_DIVERGENTE: 'O total de lances do selo difere da cadeia.',
  SELO_HASH_FINAL_DIVERGENTE: 'O hash final do selo difere do último lance.',
  SELO_ASSINATURA_INVALIDA: 'A assinatura do selo não confere com uma chave publicada.',
};

function problema(codigo: CodigoDoProblema, seq: number | null): Problema {
  return { codigo, seq, mensagem: MENSAGENS[codigo] };
}

/** Recalcula um hash; dado fora da forma canônica não reproduz o que foi assinado (`null`). */
function recalcular(calcular: () => string): string | null {
  try {
    return calcular();
  } catch (erro: unknown) {
    if (erro instanceof ErroDeCanonico) return null;
    throw erro;
  }
}

function verificarLance(
  loteId: string,
  lance: LanceRegistrado,
  anterior: LanceRegistrado | undefined,
  chaves: ReadonlyMap<string, Uint8Array>,
): Problema[] {
  const encontrados: Problema[] = [];
  // Passo 1: o seq segue o do lance anterior (o primeiro é 1).
  if (lance.seq !== (anterior?.seq ?? 0) + 1)
    encontrados.push(problema('SEQ_FORA_DE_ORDEM', lance.seq));
  // Passo 2: hashAnterior = hash gravado do anterior (ou a gênese).
  const esperado = anterior?.hash ?? hashGenese(loteId);
  if (lance.hashAnterior !== esperado)
    encontrados.push(problema('HASH_ANTERIOR_DIVERGENTE', lance.seq));
  // Passo 3: hash = SHA-256(canônico).
  if (recalcular(() => hashDoLance({ ...lance, loteId })) !== lance.hash) {
    encontrados.push(problema('HASH_DIVERGENTE', lance.seq));
  }
  // Passo 4: assinatura sobre o hash gravado, com a chave publicada do keyId.
  const chave = chaves.get(lance.keyId);
  if (chave === undefined) encontrados.push(problema('CHAVE_DESCONHECIDA', lance.seq));
  else if (!verificar(chave, lance.hash, lance.assinatura)) {
    encontrados.push(problema('ASSINATURA_INVALIDA', lance.seq));
  }
  return encontrados;
}

function verificarSelo(
  loteId: string,
  selo: SeloRegistrado,
  lances: readonly LanceRegistrado[],
  chaves: ReadonlyMap<string, Uint8Array>,
): Problema[] {
  const encontrados: Problema[] = [];
  if (selo.totalLances !== lances.length) encontrados.push(problema('SELO_TOTAL_DIVERGENTE', null));
  const hashFinal = lances.at(-1)?.hash ?? hashGenese(loteId);
  if (selo.hashFinal !== hashFinal) encontrados.push(problema('SELO_HASH_FINAL_DIVERGENTE', null));
  const chave = chaves.get(selo.keyId);
  const hash = recalcular(() => hashDoSelo({ ...selo, loteId }));
  if (chave === undefined || hash === null || !verificar(chave, hash, selo.assinatura)) {
    encontrados.push(problema('SELO_ASSINATURA_INVALIDA', null));
  }
  return encontrados;
}

/**
 * Recalcula a cadeia do lote e devolve o veredito com cada problema e o seu `seq`.
 * Lança {@link ErroDeCanonico} só se `loteId` não for UUID em minúsculas (erro de quem chama).
 */
export function verificarCadeia(entrada: EntradaDaVerificacao): ResultadoDaVerificacao {
  const { loteId, lances, selo } = entrada;
  hashGenese(loteId);
  const chaves = new Map(entrada.chaves.map((c) => [c.keyId, c.chavePublica] as const));
  const problemas = [
    ...lances.flatMap((lance, i) => verificarLance(loteId, lance, lances[i - 1], chaves)),
    ...(selo === null ? [] : verificarSelo(loteId, selo, lances, chaves)),
  ];
  return { veredito: problemas.length === 0 ? 'integro' : 'adulterado', problemas };
}
