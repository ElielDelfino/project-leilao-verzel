// Hash de senha argon2id pelo crypto.argon2 assíncrono do Node (specs/003 RNF-01, ADR 0027), no
// formato PHC `$argon2id$v=19$m=19456,t=2,p=1$<sal>$<hash>` (base64 sem padding; specs/003 §Dados).
//
// Importado pelo seed.ts do módulo, que roda com type stripping do Node (db/seed.ts): só sintaxe
// TypeScript apagável aqui (sem decorators, enum, namespace nem parameter properties).
//
// `crypto.argon2` é lido na hora da chamada (não desestruturado no import) para que o teste do
// RNF-01 consiga espioná-lo.
import crypto from 'node:crypto';

/** Parâmetros OWASP 2025 do RNF-01: memory em KiB (19 MiB), passes e parallelism. */
export const PARAMETROS_DO_ARGON2 = Object.freeze({ memory: 19_456, passes: 2, parallelism: 1 });

const BYTES_DO_SAL = 16;
const BYTES_DO_HASH = 32;
const VERSAO_DO_ARGON2 = 19;

/** Mínimo do argon2 para o sal (RFC 9106: 8 bytes) e para a saída (4 bytes). */
const BYTES_MINIMOS_DO_SAL = 8;
const BYTES_MINIMOS_DO_HASH = 4;

/**
 * Teto do custo lido de uma string PHC: uma linha corrompida no banco não pode alocar gigabytes
 * nem prender o pool de threads. Folga sobre o RNF-01 (19 MiB, 2 passadas, 1 lane).
 */
const TETO_DO_CUSTO = Object.freeze({ memory: 65_536, passes: 10, parallelism: 4 });

const FORMATO_PHC =
  /^\$argon2id\$v=19\$m=([1-9][0-9]{0,9}),t=([1-9][0-9]{0,9}),p=([1-9][0-9]{0,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** String PHC fora do formato. A mensagem nunca cita a string (ela traz sal e hash). */
export class ErroDoHashDeSenha extends Error {
  override readonly name = 'ErroDoHashDeSenha';
}

interface ParametrosDoHash {
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly sal: Buffer;
  readonly hash: Buffer;
}

function base64SemPadding(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

function derivar(
  senha: string,
  sal: Buffer,
  parametros: { memory: number; passes: number; parallelism: number },
  bytes: number,
): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    crypto.argon2(
      'argon2id',
      {
        message: Buffer.from(senha, 'utf8'),
        nonce: sal,
        memory: parametros.memory,
        passes: parametros.passes,
        parallelism: parametros.parallelism,
        tagLength: bytes,
      },
      (erro, chave) => {
        if (erro) {
          rejeitar(erro);
          return;
        }
        resolver(chave);
      },
    );
  });
}

/** Hash novo, com sal aleatório de 16 bytes e saída de 32 bytes, em PHC. */
export async function gerarHashDeSenha(senha: string): Promise<string> {
  const sal = crypto.randomBytes(BYTES_DO_SAL);
  const hash = await derivar(senha, sal, PARAMETROS_DO_ARGON2, BYTES_DO_HASH);
  const { memory, passes, parallelism } = PARAMETROS_DO_ARGON2;
  return (
    `$argon2id$v=${VERSAO_DO_ARGON2}$m=${memory},t=${passes},p=${parallelism}` +
    `$${base64SemPadding(sal)}$${base64SemPadding(hash)}`
  );
}

function lerPhc(phc: string): ParametrosDoHash {
  const partes = FORMATO_PHC.exec(phc);
  if (partes === null) {
    throw new ErroDoHashDeSenha('hash de senha fora do formato PHC argon2id');
  }
  const [, memoria, passadas, paralelismo, sal64, hash64] = partes;
  const sal = Buffer.from(sal64 ?? '', 'base64');
  const hash = Buffer.from(hash64 ?? '', 'base64');
  if (sal.length < BYTES_MINIMOS_DO_SAL || hash.length < BYTES_MINIMOS_DO_HASH) {
    throw new ErroDoHashDeSenha('hash de senha com sal ou saída curtos demais');
  }
  const custo = {
    memory: Number(memoria),
    passes: Number(passadas),
    parallelism: Number(paralelismo),
  };
  if (
    custo.memory > TETO_DO_CUSTO.memory ||
    custo.passes > TETO_DO_CUSTO.passes ||
    custo.parallelism > TETO_DO_CUSTO.parallelism
  ) {
    throw new ErroDoHashDeSenha('hash de senha com custo acima do teto');
  }
  return { ...custo, sal, hash };
}

/**
 * Confere a senha contra a string PHC, com os parâmetros lidos dela, e compara em tempo
 * constante. String malformada lança ErroDoHashDeSenha (não é "senha errada").
 */
export async function verificarSenha(senha: string, phc: string): Promise<boolean> {
  const { sal, hash, ...parametros } = lerPhc(phc);
  const calculado = await derivar(senha, sal, parametros, hash.length);
  return crypto.timingSafeEqual(calculado, hash);
}
