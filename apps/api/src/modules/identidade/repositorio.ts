// Acesso às tabelas do módulo identidade: users e refresh_tokens (specs/003 §Dados). Privilégios
// do papel da API (ADR 0026): users SELECT, INSERT; refresh_tokens SELECT, INSERT, UPDATE, DELETE.
// Os instantes de expiração e revogação usam o relógio do Postgres (now()).
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import type { PapelDoUsuario } from '../../common/auth/sessao.js';
import type { BancoDrizzle, Transacao } from '../../db/banco.js';
import { refreshTokens, users } from './schema.js';

/** Banco fora de transação ou uma transação: as funções servem às duas. */
export type Executor = BancoDrizzle | Transacao;

/** Usuário como sai na API (openapi.yaml: Usuario), sem o hash da senha. */
export interface UsuarioPublico {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  readonly papel: PapelDoUsuario;
}

export interface Credenciais extends UsuarioPublico {
  readonly senhaHash: string;
}

/** Linha do refresh token travada para a rotação. */
export interface RefreshTravado {
  readonly id: string;
  readonly userId: string;
  readonly familiaId: string;
  /** Já revogado ou já substituído por outro: usar de novo é reuso (specs/003). */
  readonly usado: boolean;
  readonly expirado: boolean;
}

/** Validade do refresh token: 7 dias (specs/003 §Cookies). */
const VALIDADE_DO_REFRESH = sql`interval '7 days'`;

const COLUNAS_PUBLICAS = {
  id: users.id,
  nome: users.nome,
  email: users.email,
  papel: users.papel,
} as const;

export async function inserirUsuario(
  db: Executor,
  dados: { nome: string; email: string; senhaHash: string; papel: PapelDoUsuario },
): Promise<UsuarioPublico> {
  const [linha] = await db.insert(users).values(dados).returning(COLUNAS_PUBLICAS);
  if (linha === undefined) {
    throw new Error('INSERT em users não devolveu a linha');
  }
  return linha;
}

/** Busca por e-mail sem diferenciar maiúsculas (coluna citext). */
export async function buscarCredenciais(
  db: Executor,
  email: string,
): Promise<Credenciais | undefined> {
  const [linha] = await db
    .select({ ...COLUNAS_PUBLICAS, senhaHash: users.senhaHash })
    .from(users)
    .where(eq(users.email, email));
  return linha;
}

export async function buscarUsuario(db: Executor, id: string): Promise<UsuarioPublico | undefined> {
  const [linha] = await db.select(COLUNAS_PUBLICAS).from(users).where(eq(users.id, id));
  return linha;
}

/** Grava só o hash do refresh token, com expiração em now() + 7 dias. Devolve o id. */
export async function inserirRefresh(
  db: Executor,
  dados: { userId: string; familiaId: string; hash: Buffer },
): Promise<string> {
  const [linha] = await db
    .insert(refreshTokens)
    .values({
      userId: dados.userId,
      familiaId: dados.familiaId,
      tokenHash: dados.hash,
      expiraEm: sql`now() + ${VALIDADE_DO_REFRESH}`,
    })
    .returning({ id: refreshTokens.id });
  if (linha === undefined) {
    throw new Error('INSERT em refresh_tokens não devolveu a linha');
  }
  return linha.id;
}

/** SELECT ... FOR UPDATE da linha do token (só refresh_tokens; users não recebe UPDATE). */
export async function travarRefresh(
  tx: Transacao,
  hash: Buffer,
): Promise<RefreshTravado | undefined> {
  const familiaId = await familiaDoToken(tx, hash);
  if (familiaId === undefined) {
    return undefined;
  }
  await travarFamilia(tx, familiaId);
  // Statement novo depois do lock: enxerga tudo o que a transação anterior da família gravou.
  const [linha] = await tx
    .select({
      id: refreshTokens.id,
      userId: refreshTokens.userId,
      familiaId: refreshTokens.familiaId,
      usado: sql<boolean>`(${refreshTokens.revogadoEm} is not null or ${refreshTokens.substituidoPor} is not null)`,
      expirado: sql<boolean>`(${refreshTokens.expiraEm} <= now())`,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .for('update');
  return linha;
}

export async function marcarSubstituido(tx: Transacao, id: string, novoId: string): Promise<void> {
  await tx.update(refreshTokens).set({ substituidoPor: novoId }).where(eq(refreshTokens.id, id));
}

/**
 * Lock transacional da família (pg_advisory_xact_lock, solto no COMMIT/ROLLBACK). Toda rotação e
 * toda revogação passam por ele: uma rotação em voo termina (e grava o token novo) antes de a
 * revogação rodar, ou a rotação seguinte já encontra o token revogado e cai no caminho de reuso.
 * Não exige privilégio de tabela (ADR 0026).
 */
async function travarFamilia(tx: Transacao, familiaId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${familiaId}, 0))`);
}

/** Família do token de hash `hash` (opcionalmente só se for do usuário `userId`). */
async function familiaDoToken(
  db: Executor,
  hash: Buffer,
  userId?: string,
): Promise<string | undefined> {
  const condicao =
    userId === undefined
      ? eq(refreshTokens.tokenHash, hash)
      : and(eq(refreshTokens.tokenHash, hash), eq(refreshTokens.userId, userId));
  const [linha] = await db
    .select({ familiaId: refreshTokens.familiaId })
    .from(refreshTokens)
    .where(condicao);
  return linha?.familiaId;
}

/**
 * Revoga todos os tokens ainda não revogados da família. Chame com o lock da família já tomado
 * (travarRefresh ou revogarFamiliaDoToken), na mesma transação.
 */
export async function revogarFamilia(tx: Transacao, familiaId: string): Promise<void> {
  await tx
    .update(refreshTokens)
    .set({ revogadoEm: sql`now()` })
    .where(and(eq(refreshTokens.familiaId, familiaId), isNull(refreshTokens.revogadoEm)));
}

/**
 * Revoga a família do token de hash `hash`, se ele existir (e, com `userId`, só se for desse
 * usuário). Trava a família antes; o UPDATE é um statement separado, depois do lock.
 */
export async function revogarFamiliaDoToken(
  tx: Transacao,
  hash: Buffer,
  userId?: string,
): Promise<void> {
  const familiaId = await familiaDoToken(tx, hash, userId);
  if (familiaId !== undefined) {
    await travarFamilia(tx, familiaId);
    await revogarFamilia(tx, familiaId);
  }
}

/** Apaga os tokens expirados antes de `limite`. Devolve quantos apagou. */
export async function apagarExpiradosAntesDe(db: Executor, limite: Date): Promise<number> {
  const apagados = await db
    .delete(refreshTokens)
    .where(lt(refreshTokens.expiraEm, limite))
    .returning({ id: refreshTokens.id });
  return apagados.length;
}
