// Contador do rate limit no Redis (specs/003 §Rate limit): INCR, EXPIRE <janela> NX e TTL num
// MULTI, então a contagem e a expiração são atômicas.
//
// Cliente próprio, separado do CLIENTE_REDIS de src/redis/ (fora dos arquivos da tarefa 038, que
// só expõe PING): com `disableOfflineQueue`, um comando com o Redis fora falha na hora em vez de
// esperar na fila, e o login/cadastro responde 500 INDISPONIVEL (falha fechada, specs/001 §Erros).
// Pendência: juntar a src/redis/cliente.ts numa tarefa que liste aquela pasta.
import { createClient } from 'redis';

import {
  type ErroDoRedis,
  paraErroDoRedis,
  TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS,
} from '../../redis/cliente.js';
import type { ConexaoDoRedis } from '../../redis/conexao.js';
import type { ContadorDeJanela, ContagemDaJanela } from './limite-de-tentativas.js';

export interface OpcoesDoContadorRedis {
  /** Contém a senha: nunca a registre. */
  readonly conexao: ConexaoDoRedis;
  /** Falha de conexão, já convertida (sem host, porta nem senha); uma vez por código. */
  readonly aoErro: (erro: ErroDoRedis) => void;
}

export interface ContadorRedis extends ContadorDeJanela {
  /** Fecha a conexão na hora. Chamar de novo não faz nada. */
  encerrar(): Promise<void>;
}

/** Avisa cada código uma vez até a próxima conexão pronta (como src/redis/cliente.ts). */
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
      aoErro(convertido);
    },
    conectou: () => {
      ultimo = undefined;
    },
  };
}

function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor)) {
    throw paraErroDoRedis(new TypeError('resposta inesperada do Redis'));
  }
  return valor;
}

export function criarContadorRedis(opcoes: OpcoesDoContadorRedis): ContadorRedis {
  const { conexao } = opcoes;
  const cliente = createClient({
    socket: {
      host: conexao.host,
      port: conexao.port,
      connectTimeout: TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS,
    },
    password: conexao.password,
    disableOfflineQueue: true,
  });
  const { avisar, conectou } = criarAviso(opcoes.aoErro);
  let encerrado = false;
  cliente.on('error', avisar);
  cliente.on('ready', conectou);
  cliente.connect().catch((erro: unknown) => {
    if (!encerrado) {
      avisar(erro);
    }
  });

  return {
    incrementar: async (chave, janelaS): Promise<ContagemDaJanela> => {
      let respostas: unknown[];
      try {
        respostas = await cliente
          .multi()
          .incr(chave)
          .expire(chave, janelaS, 'NX')
          .ttl(chave)
          .exec();
      } catch (erro: unknown) {
        throw paraErroDoRedis(erro);
      }
      return { contagem: comoNumero(respostas[0]), ttlS: comoNumero(respostas[2]) };
    },
    encerrar: () => {
      if (!encerrado) {
        encerrado = true;
        cliente.destroy();
      }
      return Promise.resolve();
    },
  };
}
