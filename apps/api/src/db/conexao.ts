// Conexão com o Postgres lida em partes (specs/014 §"Conexão da API com Postgres e Redis",
// decisão da tarefa 018): POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER e
// DB_PASSWORD, todas obrigatórias e sem default no código. Não há DATABASE_URL: uma URL
// duplicaria a senha. Usada pelo pool da API, por `pnpm db:migrate`, `pnpm db:seed` e pelo
// drizzle.config.ts.
//
// Sem imports: o drizzle.config.ts carrega este arquivo pelo loader do drizzle-kit, e a cadeia
// precisa ficar mínima.

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

const VARIAVEIS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'DB_PASSWORD',
] as const;

type Variavel = (typeof VARIAVEIS)[number];

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

function invalidas(env: Readonly<Record<string, string | undefined>>): Variavel[] {
  return VARIAVEIS.filter((nome) => {
    const valor = env[nome];
    if (valor === undefined || valor === '') {
      return true;
    }
    return nome === 'POSTGRES_PORT' && !portaValida(valor);
  });
}

function criarConexao(partes: Omit<ConexaoDoBanco, 'password'>, password: string): ConexaoDoBanco {
  const conexao = { ...partes };
  Object.defineProperty(conexao, 'password', { value: password, enumerable: false });
  return Object.freeze(conexao) as ConexaoDoBanco;
}

/** Lê a conexão do env. Falta ou valor inválido → ErroDeConfiguracaoDoBanco com os nomes. */
export function lerConexaoDoBanco(
  env: Readonly<Record<string, string | undefined>>,
): ConexaoDoBanco {
  const problemas = invalidas(env);
  if (problemas.length > 0) {
    throw new ErroDeConfiguracaoDoBanco(problemas);
  }
  // Todas presentes e não vazias (checado acima).
  const valor = (nome: Variavel): string => env[nome] ?? '';
  return criarConexao(
    {
      host: valor('POSTGRES_HOST'),
      port: Number(valor('POSTGRES_PORT')),
      database: valor('POSTGRES_DB'),
      user: valor('POSTGRES_USER'),
    },
    valor('DB_PASSWORD'),
  );
}

/** Como lerConexaoDoBanco, mas devolve undefined em vez de lançar (para quem não exige banco). */
export function conexaoSeCompleta(
  env: Readonly<Record<string, string | undefined>>,
): ConexaoDoBanco | undefined {
  return invalidas(env).length === 0 ? lerConexaoDoBanco(env) : undefined;
}

/** Mesma conexão em outro banco (testes: banco descartável ou leilao_test, specs/014). */
export function trocarBanco(conexao: ConexaoDoBanco, database: string): ConexaoDoBanco {
  return criarConexao(
    { host: conexao.host, port: conexao.port, database, user: conexao.user },
    conexao.password,
  );
}
