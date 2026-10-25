// Verificador SCRAM-SHA-256 calculado no cliente (tarefa 037, como o `db:sync-password` da 023):
// o ALTER ROLE ... PASSWORD recebe o verificador, que o Postgres guarda como está (docs do
// Postgres 18, CREATE ROLE §PASSWORD), então a senha nunca chega ao servidor nem ao texto SQL.
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Padrões do Postgres 18: scram_iterations = 4096 e sal de 16 bytes; chaves SHA-256 de 32 bytes. */
const ITERACOES_PADRAO = 4096;
const BYTES_DO_SAL = 16;
const BYTES_DA_CHAVE = 32;
/** Teto de iterações aceito ao conferir um verificador lido do banco (evita um PBKDF2 enorme). */
const ITERACOES_MAXIMAS = 1_000_000;

const FORMATO =
  /^SCRAM-SHA-256\$([0-9]{1,7}):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

const hmac = (chave: Buffer, texto: string): Buffer =>
  createHmac('sha256', chave).update(texto).digest();

function montar(senha: string, sal: Buffer, iteracoes: number): string {
  const salgada = pbkdf2Sync(senha, sal, iteracoes, BYTES_DA_CHAVE, 'sha256');
  const storedKey = createHash('sha256').update(hmac(salgada, 'Client Key')).digest();
  const serverKey = hmac(salgada, 'Server Key');
  return `SCRAM-SHA-256$${iteracoes}:${sal.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/**
 * Verificador no formato do pg_authid (RFC 5803):
 * `SCRAM-SHA-256$<iterações>:<sal>$<StoredKey>:<ServerKey>`, com as chaves da RFC 5802 §3. A
 * senha dos segredos é ASCII (base64url), então o SASLprep não a altera.
 */
export function verificadorScram(senha: string, sal: Buffer = randomBytes(BYTES_DO_SAL)): string {
  return montar(senha, sal, ITERACOES_PADRAO);
}

/** O verificador guardado (pg_authid.rolpassword) corresponde a esta senha? */
export function verificadorConfere(guardado: string | null, senha: string): boolean {
  const partes = guardado === null ? null : FORMATO.exec(guardado);
  if (partes === null) {
    return false;
  }
  const iteracoes = Number(partes[1]);
  if (iteracoes < 1 || iteracoes > ITERACOES_MAXIMAS) {
    return false;
  }
  const esperado = Buffer.from(montar(senha, Buffer.from(partes[2] ?? '', 'base64'), iteracoes));
  const recebido = Buffer.from(guardado ?? '');
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
