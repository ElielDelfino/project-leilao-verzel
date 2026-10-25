// Conexão com o Postgres lida em partes (specs/014 §"Conexão da API com Postgres e Redis",
// decisão da tarefa 018): POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, o usuário e a senha, todas
// obrigatórias e sem default no código. Não há DATABASE_URL: uma URL duplicaria a senha.
//
// Dois pares de usuário e senha (D2 da tarefa 036): o dono (POSTGRES_USER/DB_PASSWORD), usado por
// `pnpm db:migrate`, `pnpm db:seed` e pelo drizzle.config.ts; e o papel da API
// (POSTGRES_API_USER/DB_API_PASSWORD), escolhido com VARIAVEIS_DA_API. A senha vem de exatamente
// uma de <VAR> ou <VAR>_FILE, na forma canônica (specs/014 §Leitura, config/segredos.ts).
//
// O drizzle.config.ts carrega este arquivo pelo loader do drizzle-kit: a cadeia de imports fica
// mínima (só config/segredos.ts, que importa apenas node:fs e node:path).
import { ehSegredoCanonico, resolverSegredo } from '../config/segredos.js';

/**
 * Parâmetros aceitos pelo `pg` (Pool e Client). `password` é não enumerável: não aparece em
 * JSON.stringify, Object.keys, spread nem util.inspect. Para trocar o banco, use trocarBanco
 * (um spread perderia a senha).
 */
export interface ConexaoDoBanco {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/** Nomes das variáveis de usuário e de senha (a senha também aceita `<senha>_FILE`). */
export interface VariaveisDoUsuario {
  readonly usuario: string;
  readonly senha: string;
}

/** Dono do banco: migrations, seed e drizzle-kit. */
export const VARIAVEIS_DO_DONO: VariaveisDoUsuario = Object.freeze({
  usuario: 'POSTGRES_USER',
  senha: 'DB_PASSWORD',
});

/** Papel da API (leilao_api): só os privilégios da matriz D3. */
export const VARIAVEIS_DA_API: VariaveisDoUsuario = Object.freeze({
  usuario: 'POSTGRES_API_USER',
  senha: 'DB_API_PASSWORD',
});

const VARIAVEIS_DO_SERVIDOR = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB'] as const;

type Env = Readonly<Record<string, string | undefined>>;

const PORTA = /^[0-9]{1,5}$/;
const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65_535;

/** Variável de conexão ausente ou inválida. A mensagem cita só os nomes, nunca os valores. */
export class ErroDeConfiguracaoDoBanco extends Error {
  override readonly name = 'ErroDeConfiguracaoDoBanco';
  readonly variaveis: readonly string[];

  constructor(variaveis: readonly string[]) {
    super(`Conexão com o Postgres: variáveis ausentes ou inválidas: ${variaveis.join(', ')}`);
    this.variaveis = Object.freeze([...variaveis]);
  }
}

function portaValida(valor: string): boolean {
  if (!PORTA.test(valor)) {
    return false;
  }
  const porta = Number(valor);
  return porta >= PORTA_MINIMA && porta <= PORTA_MAXIMA;
}

function texto(env: Env, nome: string): string | undefined {
  const valor = env[nome];
  return valor === undefined || valor === '' ? undefined : valor;
}

type Leitura =
  | { readonly ok: true; readonly conexao: ConexaoDoBanco }
  | { readonly ok: false; readonly variaveis: readonly string[] };

/** Senha de `nome` ou de `nome_FILE`; o problema cita só a variável de origem. */
function lerSenha(
  env: Env,
  nome: string,
): { ok: true; senha: string } | { ok: false; variaveis: string[] } {
  const arquivo = `${nome}_FILE`;
  if (env[nome] !== undefined && env[arquivo] !== undefined) {
    return { ok: false, variaveis: [nome, arquivo] };
  }
  const resolvido = resolverSegredo(env, nome);
  if (!resolvido.ok) {
    return { ok: false, variaveis: [env[arquivo] === undefined ? nome : arquivo] };
  }
  if (!ehSegredoCanonico(resolvido.valor)) {
    return { ok: false, variaveis: [resolvido.variavel] };
  }
  return { ok: true, senha: resolvido.valor };
}

function ler(env: Env, nomes: VariaveisDoUsuario): Leitura {
  const problemas: string[] = VARIAVEIS_DO_SERVIDOR.filter((nome) => {
    const valor = texto(env, nome);
    return valor === undefined || (nome === 'POSTGRES_PORT' && !portaValida(valor));
  });
  const usuario = texto(env, nomes.usuario);
  if (usuario === undefined) {
    problemas.push(nomes.usuario);
  }
  const senha = lerSenha(env, nomes.senha);
  if (!senha.ok) {
    problemas.push(...senha.variaveis);
  }
  if (problemas.length > 0 || usuario === undefined || !senha.ok) {
    return { ok: false, variaveis: problemas };
  }
  // Presentes e não vazias (checado acima).
  const valor = (nome: string): string => env[nome] ?? '';
  return {
    ok: true,
    conexao: criarConexao(
      {
        host: valor('POSTGRES_HOST'),
        port: Number(valor('POSTGRES_PORT')),
        database: valor('POSTGRES_DB'),
        user: usuario,
      },
      senha.senha,
    ),
  };
}

function criarConexao(partes: Omit<ConexaoDoBanco, 'password'>, password: string): ConexaoDoBanco {
  const conexao = { ...partes };
  Object.defineProperty(conexao, 'password', { value: password, enumerable: false });
  return Object.freeze(conexao) as ConexaoDoBanco;
}

/**
 * Lê a conexão do env, com o usuário e a senha de `nomes` (padrão: o dono). Falta, valor inválido,
 * <senha> e <senha>_FILE juntas, arquivo ilegível ou senha fora da forma canônica →
 * ErroDeConfiguracaoDoBanco com os nomes das variáveis, nunca os valores nem o caminho.
 */
export function lerConexaoDoBanco(
  env: Env,
  nomes: VariaveisDoUsuario = VARIAVEIS_DO_DONO,
): ConexaoDoBanco {
  const leitura = ler(env, nomes);
  if (!leitura.ok) {
    throw new ErroDeConfiguracaoDoBanco(leitura.variaveis);
  }
  return leitura.conexao;
}

/** Como lerConexaoDoBanco, mas devolve undefined em vez de lançar (para quem não exige banco). */
export function conexaoSeCompleta(
  env: Env,
  nomes: VariaveisDoUsuario = VARIAVEIS_DO_DONO,
): ConexaoDoBanco | undefined {
  const leitura = ler(env, nomes);
  return leitura.ok ? leitura.conexao : undefined;
}

/** Mesma conexão em outro banco (testes: banco descartável ou leilao_test, specs/014). */
export function trocarBanco(conexao: ConexaoDoBanco, database: string): ConexaoDoBanco {
  return criarConexao(
    { host: conexao.host, port: conexao.port, database, user: conexao.user },
    conexao.password,
  );
}
