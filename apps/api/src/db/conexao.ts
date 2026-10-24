// Conexão com o Postgres lida em partes (specs/014 §"Conexão da API com Postgres e Redis",
// decisão da tarefa 018): POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER e
// DB_PASSWORD, todas obrigatórias e sem default no código. Não há DATABASE_URL: uma URL
// duplicaria a senha. Usada pelo pool da API, por `pnpm db:migrate`, `pnpm db:seed` e pelo
// drizzle.config.ts.
import { ErroDeConfiguracao } from '../config/env.js';

/** Parâmetros aceitos pelo `pg` (Pool e Client). `password` é segredo: nunca o registre. */
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

const PORTA = /^[0-9]{1,5}$/;
const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65_535;

function portaValida(valor: string): boolean {
  if (!PORTA.test(valor)) {
    return false;
  }
  const porta = Number(valor);
  return porta >= PORTA_MINIMA && porta <= PORTA_MAXIMA;
}

/** Lê a conexão do env. Falta ou valor inválido → ErroDeConfiguracao com os nomes, nunca os valores. */
export function lerConexaoDoBanco(
  env: Readonly<Record<string, string | undefined>>,
): ConexaoDoBanco {
  const invalidas = VARIAVEIS.filter((nome) => {
    const valor = env[nome];
    if (valor === undefined || valor === '') {
      return true;
    }
    return nome === 'POSTGRES_PORT' && !portaValida(valor);
  });
  if (invalidas.length > 0) {
    throw new ErroDeConfiguracao(
      `Conexão com o Postgres: variáveis ausentes ou inválidas: ${invalidas.join(', ')}`,
    );
  }
  // Todas presentes e não vazias (checado acima).
  const valor = (nome: (typeof VARIAVEIS)[number]): string => env[nome] ?? '';
  return {
    host: valor('POSTGRES_HOST'),
    port: Number(valor('POSTGRES_PORT')),
    database: valor('POSTGRES_DB'),
    user: valor('POSTGRES_USER'),
    password: valor('DB_PASSWORD'),
  };
}
