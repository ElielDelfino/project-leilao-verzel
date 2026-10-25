// Runner de `pnpm db:migrate` (tarefa 003): aplica as migrations SQL de
// database/postgres/migrations (forward-only, ADR 0001) no banco de POSTGRES_* + DB_PASSWORD
// (conexao.ts). Idempotente: o migrator do Drizzle registra cada migration em
// drizzle.__drizzle_migrations e só aplica as novas, todas numa transação; um advisory lock
// serializa execuções simultâneas (deploy e verify, por exemplo).
//
// Depois das migrations, dá LOGIN e a senha de DB_API_PASSWORD (ou DB_API_PASSWORD_FILE) ao papel
// de POSTGRES_API_USER (leilao_api, criado pela migration 0001; D2 da tarefa 036), com um
// verificador SCRAM-SHA-256 calculado aqui: a senha não vai no texto SQL, no log nem em mensagem.
//
// Roda direto no Node >= 24.2 (type stripping e import.meta.main) com o hook resolver-ts.mjs
// (script na raiz).
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { causaParaExibir, comClienteAvulso, criarClientePg, SEM_CAUSA } from './cliente-avulso.js';
import {
  type ConexaoDoBanco,
  ErroDeConfiguracaoDoBanco,
  lerConexaoDoBanco,
  VARIAVEIS_DA_API,
} from './conexao.js';
import { verificadorConfere, verificadorScram } from './scram.js';

/** Pasta das migrations; de src/db/ ou dist/db/, a raiz do repositório fica 4 níveis acima. */
export const PASTA_DAS_MIGRATIONS = fileURLToPath(
  new URL('../../../../database/postgres/migrations', import.meta.url),
);

/** Chave do advisory lock das migrations (constante arbitrária, só precisa ser única no banco). */
const CHAVE_DO_LOCK = 3_003_000_001;

/** Quanto uma execução espera a outra liberar o lock antes de desistir (lock_timeout). */
export const ESPERA_PADRAO_DO_LOCK_MS = 60_000;

export interface OpcoesDasMigrations {
  readonly pasta?: string;
  readonly esperaDoLockMs?: number;
}

/**
 * Aplica as migrations pendentes numa única conexão (o advisory lock vale por sessão). Se a
 * migração falhar, o unlock nem é tentado: fechar a sessão libera o lock, e assim nenhuma falha
 * secundária esconde a original.
 */
export async function aplicarMigrations(
  conexao: ConexaoDoBanco,
  opcoes: OpcoesDasMigrations = {},
): Promise<void> {
  const pasta = opcoes.pasta ?? PASTA_DAS_MIGRATIONS;
  const espera = opcoes.esperaDoLockMs ?? ESPERA_PADRAO_DO_LOCK_MS;
  await comClienteAvulso(
    conexao,
    async (cliente) => {
      // Sem limite, uma segunda execução esperaria para sempre por uma primeira travada.
      await cliente.query("select set_config('lock_timeout', $1, false)", [
        String(Math.trunc(espera)),
      ]);
      await cliente.query('select pg_advisory_lock($1)', [CHAVE_DO_LOCK]);
      await cliente.query('reset lock_timeout');
      await migrate(drizzle({ client: cliente }), { migrationsFolder: pasta });
      await cliente.query('select pg_advisory_unlock($1)', [CHAVE_DO_LOCK]);
    },
    criarClientePg,
  );
}

/** Papel da API inexistente ou impróprio. A mensagem cita só a variável, nunca o nome do papel. */
export class ErroDoPapelDaApi extends Error {
  override readonly name = 'ErroDoPapelDaApi';
}

/** Identificador simples do Postgres (o papel entra no SQL por escapeIdentifier de todo modo). */
const IDENTIFICADOR = /^[a-z_][a-z0-9_]{0,62}$/;

interface AtributosDoPapel {
  readonly pode_entrar: boolean;
  readonly administrativo: boolean;
  readonly eh_o_dono: boolean;
  readonly verificador: string | null;
}

export type ResultadoDaSenha = 'ja-sincronizada' | 'sincronizada';

/**
 * ALTER ROLE numa transação com o log de comandos desligado só para ela (SET LOCAL; exige
 * superusuário, que o dono é): nem log_statement nem o registro do comando que falha
 * (log_min_error_statement) levam o verificador ao log do Postgres. ROLLBACK se algo falhar.
 */
async function alterarSenhaForaDoLog(
  cliente: pg.Client,
  papel: string,
  verificador: string,
): Promise<void> {
  await cliente.query('begin');
  try {
    await cliente.query("set local log_statement = 'none'");
    await cliente.query("set local log_min_error_statement = 'panic'");
    await cliente.query(
      `alter role ${pg.escapeIdentifier(papel)} login password ${pg.escapeLiteral(verificador)}`,
    );
    await cliente.query('commit');
  } catch (erro: unknown) {
    await cliente.query('rollback').catch(() => undefined);
    throw erro;
  }
}

/**
 * Dá LOGIN e a senha ao papel da API, conectando como o dono (superusuário, que lê pg_authid).
 * Idempotente: se o papel já entra com essa senha, nada é alterado. Recusa um papel inexistente,
 * o próprio dono e qualquer papel com atributo de administração (um POSTGRES_API_USER errado não
 * troca a senha do dono). O SQL leva só o verificador SCRAM; usado também pelo e2e (tarefa 041).
 */
export async function sincronizarSenhaDoPapelDaApi(
  conexaoDoDono: ConexaoDoBanco,
  papel: string,
  senha: string,
  criar: (conexao: ConexaoDoBanco) => pg.Client = criarClientePg,
): Promise<ResultadoDaSenha> {
  const variavel = VARIAVEIS_DA_API.usuario;
  if (!IDENTIFICADOR.test(papel)) {
    throw new ErroDoPapelDaApi(`${variavel} fora de [a-z_][a-z0-9_]*`);
  }
  return comClienteAvulso(
    conexaoDoDono,
    async (cliente) => {
      const { rows } = await cliente.query<AtributosDoPapel>(
        `select rolcanlogin as pode_entrar,
                (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls)
                  as administrativo,
                rolname = current_user as eh_o_dono,
                rolpassword as verificador
           from pg_catalog.pg_authid where rolname = $1`,
        [papel],
      );
      const atributos = rows[0];
      if (atributos === undefined) {
        throw new ErroDoPapelDaApi(`${variavel}: o papel não existe (rode as migrations)`);
      }
      if (atributos.administrativo || atributos.eh_o_dono) {
        throw new ErroDoPapelDaApi(
          `${variavel}: o papel é o dono ou tem atributo de administração; use o papel da API`,
        );
      }
      if (atributos.pode_entrar && verificadorConfere(atributos.verificador, senha)) {
        return 'ja-sincronizada';
      }
      await alterarSenhaForaDoLog(cliente, papel, verificadorScram(senha));
      return 'sincronizada';
    },
    criar,
  );
}

/**
 * Descrição da falha para o terminal. Migrations não levam dados de usuário, então a mensagem
 * do Postgres (ex.: "type ... already exists") é mostrada; a do DrizzleQueryError (SQL e
 * parâmetros) nunca é, e a senha nunca entra em mensagem.
 */
export function descreverFalha(erro: unknown): string {
  const causa = causaParaExibir(erro);
  if (causa === SEM_CAUSA) {
    return 'consulta do Drizzle falhou sem causa do driver';
  }
  if (causa instanceof pg.DatabaseError) {
    return `SQLSTATE ${causa.code ?? '?'}: ${causa.message}`;
  }
  if (causa instanceof ErroDeConfiguracaoDoBanco || causa instanceof ErroDoPapelDaApi) {
    return causa.message;
  }
  if (causa instanceof Error) {
    const codigo = 'code' in causa && typeof causa.code === 'string' ? ` (${causa.code})` : '';
    return `${causa.name}${codigo}: ${causa.message}`;
  }
  return 'falha desconhecida';
}

async function principal(): Promise<void> {
  // As duas leituras antes de tudo: configuração incompleta falha sem tocar no banco.
  const dono = lerConexaoDoBanco(process.env);
  const api = lerConexaoDoBanco(process.env, VARIAVEIS_DA_API);
  await aplicarMigrations(dono);
  const resultado = await sincronizarSenhaDoPapelDaApi(dono, api.user, api.password);
  const senha = resultado === 'sincronizada' ? 'aplicada' : 'já em dia';
  process.stdout.write(
    `db:migrate: migrations aplicadas (ou já em dia); senha do papel da API ${senha}.\n`,
  );
}

if (import.meta.main) {
  principal().catch((erro: unknown) => {
    process.stderr.write(`db:migrate falhou: ${descreverFalha(erro)}\n`);
    process.exitCode = 1;
  });
}
