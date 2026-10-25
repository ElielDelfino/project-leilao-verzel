// Clientes pub/sub para o adapter Redis do Socket.IO (specs/009, ADR 0010), criados por
// `duplicate()` do cliente da API: herdam host, senha e `disableOfflineQueue`, então com o Redis
// fora um publish rejeita na hora, em vez de esperar numa fila.
//
// O @socket.io/redis-adapter dispara `publish`, `subscribe` e `pSubscribe` sem tratar a rejeição;
// com o Redis fora isso viraria `unhandledRejection` e derrubaria o processo. Por isso o adapter
// recebe uma casca que engole a rejeição e a entrega a `avisar` (que registra só o tipo e o código
// do erro, sem host nem senha). Falha de Redis não derruba a API (specs/001 §Erros).
import { EventEmitter } from 'node:events';

import type { ClienteNodeRedis } from './cliente.js';

/** O que o cliente base oferece para o aviso de erro de conexão (o `criarAviso` do cliente). */
export interface AvisoDeErroDoRedis {
  readonly avisar: (erro: unknown) => void;
  readonly conectou: () => void;
}

/** Cliente entregue a `createAdapter` do @socket.io/redis-adapter (que o tipa como `any`). */
export type ClienteDoAdapter = object;

export interface ClientesPubSub {
  readonly pub: ClienteDoAdapter;
  readonly sub: ClienteDoAdapter;
  /**
   * Espera os dois clientes ficarem prontos. Devolve `false` na primeira falha de conexão ou se o
   * `sinal` abortar antes, para o boot seguir sem o adapter em vez de esperar o tempo limite.
   */
  aguardarConexao(sinal: AbortSignal): Promise<boolean>;
  /** Fecha os dois clientes na hora. Chamar de novo não faz nada. */
  encerrar(): Promise<void>;
}

const METODOS_COM_PROMESSA = [
  'publish',
  'pSubscribe',
  'subscribe',
  'pUnsubscribe',
  'unsubscribe',
] as const;

/** Casca sem rejeição: cada método do adapter que devolve promessa passa a nunca rejeitar. */
function protegido(cliente: ClienteNodeRedis, avisar: (erro: unknown) => void): ClienteDoAdapter {
  const emissor: EventEmitter = cliente;
  const casca: Record<string, unknown> = {
    on: (evento: string, ouvinte: (...argumentos: unknown[]) => void) =>
      emissor.on(evento, ouvinte),
    off: (evento: string, ouvinte: (...argumentos: unknown[]) => void) =>
      emissor.off(evento, ouvinte),
  };
  for (const metodo of METODOS_COM_PROMESSA) {
    casca[metodo] = async (...argumentos: unknown[]): Promise<void> => {
      try {
        await (Reflect.apply(cliente[metodo], cliente, argumentos) as Promise<unknown>);
      } catch (erro: unknown) {
        avisar(erro);
      }
    };
  }
  return casca;
}

function aguardarPronto(cliente: ClienteNodeRedis, sinal: AbortSignal): Promise<boolean> {
  if (cliente.isReady) {
    return Promise.resolve(true);
  }
  if (sinal.aborted) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolver) => {
    const terminar = (pronto: boolean): void => {
      cliente.off('ready', aoFicarPronto);
      cliente.off('error', aoFalhar);
      sinal.removeEventListener('abort', aoAbortar);
      resolver(pronto);
    };
    const aoFicarPronto = (): void => {
      terminar(true);
    };
    const aoFalhar = (): void => {
      terminar(false);
    };
    const aoAbortar = (): void => {
      terminar(false);
    };
    cliente.on('ready', aoFicarPronto);
    cliente.on('error', aoFalhar);
    sinal.addEventListener('abort', aoAbortar, { once: true });
  });
}

function abrirDuplicado(
  base: ClienteNodeRedis,
  aviso: AvisoDeErroDoRedis,
  encerrado: () => boolean,
): ClienteNodeRedis {
  const duplicado = base.duplicate();
  // Sem listener de 'error', o EventEmitter derrubaria o processo.
  duplicado.on('error', aviso.avisar);
  duplicado.on('ready', aviso.conectou);
  duplicado.connect().catch((erro: unknown) => {
    if (!encerrado()) {
      aviso.avisar(erro);
    }
  });
  return duplicado;
}

/** Duplica `base` duas vezes (publicação e assinatura) e começa a conectar, sem esperar. */
export function criarClientesPubSub(
  base: ClienteNodeRedis,
  novoAviso: () => AvisoDeErroDoRedis,
): ClientesPubSub {
  let encerrado = false;
  const avisoDoPub = novoAviso();
  const avisoDoSub = novoAviso();
  const pub = abrirDuplicado(base, avisoDoPub, () => encerrado);
  const sub = abrirDuplicado(base, avisoDoSub, () => encerrado);
  return {
    pub: protegido(pub, avisoDoPub.avisar),
    sub: protegido(sub, avisoDoSub.avisar),
    aguardarConexao: async (sinal) => {
      const prontos = await Promise.all([aguardarPronto(pub, sinal), aguardarPronto(sub, sinal)]);
      return prontos.every(Boolean);
    },
    encerrar: () => {
      encerrado = true;
      pub.destroy();
      sub.destroy();
      return Promise.resolve();
    },
  };
}
