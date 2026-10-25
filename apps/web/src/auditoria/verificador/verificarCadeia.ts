// Os 5 passos de specs/008 §Verificação no navegador: WebCrypto (SHA-256) + @noble/ed25519.
import { verifyAsync } from '@noble/ed25519';

import { deBase64Url, deHex, hashGenese } from './canonico';
import { canonicoDoLance, canonicoDoSelo, recalcular } from './hashes';
import {
  type CodigoDoProblema,
  type EntradaDaVerificacao,
  ErroDeContextoInseguro,
  type LanceDaCadeia,
  type Problema,
  type RetornoDaVerificacao,
  type SeloDoLote,
} from './tipos';

const TAMANHO_DA_ASSINATURA = 64;
const TAMANHO_DA_CHAVE = 32;
const TAMANHO_DO_BLOCO = 50;
const HEX_64 = /^[0-9a-f]{64}$/;

function cederAoEventLoop(): Promise<void> {
  return new Promise((resolver) => {
    setTimeout(resolver, 0);
  });
}

/** Verifica os lances em blocos, cedendo ao event loop entre eles; ordem dos problemas preservada. */
async function verificarLances(
  loteId: string,
  lances: readonly LanceDaCadeia[],
  chaves: ChavesPorId,
): Promise<Problema[]> {
  const achados: Problema[] = [];
  for (let inicio = 0; inicio < lances.length; inicio += TAMANHO_DO_BLOCO) {
    if (inicio > 0) await cederAoEventLoop();
    const bloco = lances.slice(inicio, inicio + TAMANHO_DO_BLOCO);
    const porLance = await Promise.all(
      bloco.map((lance, i) => verificarLance(loteId, lance, lances[inicio + i - 1], chaves)),
    );
    achados.push(...porLance.flat());
  }
  return achados;
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

type ChavesPorId = ReadonlyMap<string, Uint8Array>;

function problema(codigo: CodigoDoProblema, seq: number | null): Problema {
  return { codigo, seq, mensagem: MENSAGENS[codigo] };
}

/**
 * Assinatura Ed25519 sobre os 32 bytes do hash; entrada malformada (tamanho, base64url, hex)
 * devolve `false`. `zip215: false` rejeita R/A não canônicos e chaves de ordem pequena. O
 * navegador é mais estrito que o servidor (o OpenSSL aceita a chave de ordem pequena): pode dar
 * "adulterado" onde o servidor daria "íntegro", nunca o contrário. Não há paridade exata. Falha de ambiente (sem WebCrypto) não é capturada: sobe para quem chamou.
 */
async function assinaturaConfere(
  chave: Uint8Array,
  hashHex: string,
  assinatura: string,
): Promise<boolean> {
  const bytes = deBase64Url(assinatura);
  if (bytes?.length !== TAMANHO_DA_ASSINATURA || chave.length !== TAMANHO_DA_CHAVE) return false;
  if (!HEX_64.test(hashHex)) return false;
  if (globalThis.crypto?.subtle === undefined) throw new ErroDeContextoInseguro();
  return verifyAsync(bytes, deHex(hashHex), chave, { zip215: false });
}

async function verificarLance(
  loteId: string,
  lance: LanceDaCadeia,
  anterior: LanceDaCadeia | undefined,
  chaves: ChavesPorId,
): Promise<Problema[]> {
  const achados: Problema[] = [];
  if (lance.seq !== (anterior?.seq ?? 0) + 1)
    achados.push(problema('SEQ_FORA_DE_ORDEM', lance.seq));
  const esperado = anterior?.hash ?? (await hashGenese(loteId));
  if (lance.hashAnterior !== esperado)
    achados.push(problema('HASH_ANTERIOR_DIVERGENTE', lance.seq));
  if ((await recalcular(() => canonicoDoLance(loteId, lance))) !== lance.hash) {
    achados.push(problema('HASH_DIVERGENTE', lance.seq));
  }
  const chave = chaves.get(lance.keyId);
  if (chave === undefined) achados.push(problema('CHAVE_DESCONHECIDA', lance.seq));
  else if (!(await assinaturaConfere(chave, lance.hash, lance.assinatura))) {
    achados.push(problema('ASSINATURA_INVALIDA', lance.seq));
  }
  return achados;
}

async function verificarSelo(
  loteId: string,
  selo: SeloDoLote,
  lances: readonly LanceDaCadeia[],
  chaves: ChavesPorId,
): Promise<Problema[]> {
  const achados: Problema[] = [];
  if (selo.totalLances !== lances.length) achados.push(problema('SELO_TOTAL_DIVERGENTE', null));
  const hashFinal = lances.at(-1)?.hash ?? (await hashGenese(loteId));
  if (selo.hashFinal !== hashFinal) achados.push(problema('SELO_HASH_FINAL_DIVERGENTE', null));
  const chave = chaves.get(selo.keyId);
  const hash = await recalcular(() => canonicoDoSelo(loteId, selo));
  if (
    chave === undefined ||
    hash === null ||
    !(await assinaturaConfere(chave, hash, selo.assinatura))
  ) {
    achados.push(problema('SELO_ASSINATURA_INVALIDA', null));
  }
  return achados;
}

function decodificarChaves(entrada: EntradaDaVerificacao): ChavesPorId {
  const mapa = new Map<string, Uint8Array>();
  for (const { keyId, chavePublica } of entrada.chaves) {
    const bytes = deBase64Url(chavePublica);
    // Chave malformada fica de fora: a assinatura que dependa dela não verifica.
    if (bytes?.length === TAMANHO_DA_CHAVE) mapa.set(keyId, bytes);
  }
  return mapa;
}

function keyIdsReferenciados(entrada: EntradaDaVerificacao): string[] {
  const ids = entrada.lances.map((l) => l.keyId);
  if (entrada.selo !== null) ids.push(entrada.selo.keyId);
  return [...new Set(ids)];
}

/**
 * Recalcula a cadeia no navegador. Se algum `keyId` falta nas chaves e `chavesAtualizadas` não é
 * `true`, devolve a pendência para a UI refazer a consulta de chaves uma vez (specs/008).
 * Lança `ErroDeContextoInseguro` sem `crypto.subtle` e `ErroDeCanonico` se `loteId` não é UUID.
 *
 * A UI deve tratar QUALQUER exceção como "não verificável" (nunca como "íntegro" nem
 * "adulterado") e passar o `loteId` da ROTA, não o da resposta da API.
 */
export async function verificarCadeia(
  entrada: EntradaDaVerificacao,
): Promise<RetornoDaVerificacao> {
  const { loteId, lances, selo } = entrada;
  await hashGenese(loteId);
  const chaves = decodificarChaves(entrada);
  const referenciados = keyIdsReferenciados(entrada);
  const ausentes = referenciados.filter((id) => !chaves.has(id));
  if (ausentes.length > 0 && entrada.chavesAtualizadas !== true) {
    return { tipo: 'pendente', keyIdsAusentes: ausentes };
  }
  const doLances = await verificarLances(loteId, lances, chaves);
  const doSelo = selo === null ? [] : await verificarSelo(loteId, selo, lances, chaves);
  const problemas = [...doLances, ...doSelo];
  return {
    tipo: 'concluida',
    veredito: problemas.length === 0 ? 'integro' : 'adulterado',
    problemas,
    keyIdsUsados: referenciados.filter((id) => chaves.has(id)),
  };
}
