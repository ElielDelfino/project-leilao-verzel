// Cliente Redis da API (node-redis 6, ADR 0010), criado a partir de ConexaoDoRedis (env.ts).
// Todo erro que sai daqui é ErroDoRedis, só com o tipo e o código: a mensagem do node-redis e a do
// Node podem trazer host e porta ("connect ECONNREFUSED 127.0.0.1:6379"), e a regra de specs/001
// §Erros manda converter o erro de biblioteca antes de ele seguir. Os comandos que os módulos
// precisarem (cache, rate limit, adapter do Socket.IO) entram nesta interface quando nascerem.
import { createClient } from 'redis';

import { codigoDoErro } from '../logger/falha-sem-detalhes.js';
import type { ConexaoDoRedis } from './conexao.js';

/**
 * Espera por uma conexão TCP antes de desistir dela e tentar de novo, como o
 * connectionTimeoutMillis do pool do Postgres (db/banco.ts). Sem `socketTimeout`, a estratégia
 * padrão do node-redis tenta reconectar para sempre (backoff de 50 ms a 2 s, com jitter).
 */
export const TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS = 5_000;

const NOME_DE_CLASSE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Erro do Redis já sem mensagem do driver, host, porta ou senha; seguro para o log. */
export class ErroDoRedis extends Error {
  override readonly name = 'ErroDoRedis';
  /** Classe do erro original (AbortError, ClientClosedError, ErrorReply...). */
  readonly tipo: string;
  /** Código de sistema (ECONNREFUSED, ETIMEDOUT...), se houver. */
  readonly codigo: string | undefined;

  constructor(tipo: string, codigo: string | undefined) {
    super(`Erro do Redis (${codigo === undefined ? tipo : `${tipo}, código ${codigo}`})`);
    this.tipo = tipo;
    this.codigo = codigo;
  }
}

function tipoDoErro(erro: unknown): string {
  if (!(erro instanceof Error)) {
    return typeof erro;
  }
  // Os erros do node-redis não definem `name` (ficam "Error"); o construtor diz qual é.
  const nome = erro.constructor.name;
  return NOME_DE_CLASSE.test(nome) ? nome : 'Error';
}

/** Converte qualquer erro do cliente em ErroDoRedis (o original não vai em `cause`). */
export function paraErroDoRedis(erro: unknown): ErroDoRedis {
  return erro instanceof ErroDoRedis ? erro : new ErroDoRedis(tipoDoErro(erro), codigoDoErro(erro));
}

export interface OpcoesDoClienteRedis {
  /** Contém a senha: nunca a registre. */
  readonly conexao: ConexaoDoRedis;
  /**
   * Falha de conexão (Redis fora, senha recusada...). O node-redis tenta reconectar sozinho e
   * emite um erro a cada tentativa; este callback recebe só o primeiro de cada código desde a
   * última conexão bem-sucedida, para não inundar o log enquanto o Redis está fora.
   */
  readonly aoErro: (erro: ErroDoRedis) => void;
}

export interface ClienteRedis {
  /**
   * PING. Rejeita com ErroDoRedis se o Redis não responder PONG. O `sinal` cancela o comando que
   * ainda está na fila (Redis fora ou reconectando), para um tempo limite não deixá-lo pendurado.
   */
  ping(sinal: AbortSignal): Promise<void>;
  /** Fecha a conexão na hora, rejeitando o que estiver na fila. Chamar de novo não faz nada. */
  encerrar(): Promise<void>;
}

/** Avisa cada código uma vez até a próxima conexão pronta. */
function criarAviso(aoErro: (erro: ErroDoRedis) => void): {
  avisar: (erro: unknown) => void;
  conectou: () => void;
} {
  let ultimo: string | undefined;
  return {
    avisar: (erro) => {
      const convertido = paraErroDoRedis(erro);
      const chave = `${convertido.tipo}:${convertido.codigo ?? ''}`;
      if (chave === ultimo) {
        return;
      }
      ultimo = chave;
      try {
        aoErro(convertido);
      } catch (falha: unknown) {
        process.stderr.write(
          `[redis] aoErro lançou ${tipoDoErro(falha)}; o aviso foi descartado\n`,
        );
      }
    },
    conectou: () => {
      ultimo = undefined;
    },
  };
}

/**
 * Cria o cliente e já começa a conectar, sem esperar: a API sobe com o Redis fora e o
 * /api/health/ready responde 503 até ele voltar (specs/014). Os comandos feitos antes da conexão
 * ficam na fila do node-redis até ela abrir ou até o sinal do comando abortar.
 */
export function criarClienteRedis(opcoes: OpcoesDoClienteRedis): ClienteRedis {
  const { conexao } = opcoes;
  const cliente = createClient({
    socket: {
      host: conexao.host,
      port: conexao.port,
      connectTimeout: TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS,
    },
    password: conexao.password,
  });
  const { avisar, conectou } = criarAviso(opcoes.aoErro);
  let encerrado = false;
  // Sem listener de 'error', o EventEmitter derrubaria o processo.
  cliente.on('error', avisar);
  cliente.on('ready', conectou);
  cliente.connect().catch((erro: unknown) => {
    // Depois de encerrar, a rejeição do connect é esperada (ClientClosedError).
    if (!encerrado) {
      avisar(erro);
    }
  });

  return {
    ping: async (sinal) => {
      let resposta: string;
      try {
        resposta = await cliente.withAbortSignal(sinal).ping();
      } catch (erro: unknown) {
        throw paraErroDoRedis(erro);
      }
      if (resposta !== 'PONG') {
        throw new ErroDoRedis('RespostaInesperada', undefined);
      }
    },
    encerrar: () => {
      encerrado = true;
      cliente.destroy();
      return Promise.resolve();
    },
  };
}
