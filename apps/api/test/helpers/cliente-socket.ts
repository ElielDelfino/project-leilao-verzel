// Cliente Socket.IO dos testes de tempo real (tarefa 090): conexão com `Origin` e cookie, entrada
// em lote com o ack validado contra o asyncapi, gravação dos eventos recebidos (com o instante de
// chegada) e esperas por condição. Só `pausa` espera tempo fixo, e só para provar silêncio.
import { io, type Socket } from 'socket.io-client';

import { validarAckDeEntrada } from '../modules/tempo-real/contrato-asyncapi.js';

export const ORIGEM_DO_TESTE = 'http://localhost:15173';
/** Timeout dos testes que fazem rajada, espera ou reconexão (o padrão de 5 s não basta). */
export { TIMEOUT_LONGO_MS } from './timeouts.js';
export const ESPERA_MS = 10_000;
export const SILENCIO_MS = 300;
const INTERVALO_PADRAO_MS = 10;

export interface Recebido {
  readonly evento: string;
  readonly payload: unknown;
  /** `performance.now()` na chegada ao cliente (mesmo processo do servidor nos testes). */
  readonly em: number;
}

export interface AckDeSucesso {
  readonly sucesso: true;
  readonly estado: Readonly<Record<string, unknown>> & { readonly suaPosicao?: string };
}

export interface AckDeErro {
  readonly sucesso: false;
  readonly erro: { readonly codigo: string; readonly mensagem: string };
}

export type AckDeEntrada = AckDeSucesso | AckDeErro;

export interface OpcoesDoCliente {
  /** Cabeçalho `Cookie` do handshake; sem ele a conexão é anônima. */
  readonly cookie?: string;
  readonly transports?: readonly ('websocket' | 'polling')[];
}

export interface ResultadoDaTentativa {
  readonly socket: Socket;
  /** Mensagem do `connect_error`; `undefined` quando conectou. */
  readonly erro: string | undefined;
}

export function pausa(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Espera a condição (síncrona ou não) ficar verdadeira; falha com `descricao` no limite. */
export async function ate(
  condicao: () => boolean | Promise<boolean>,
  opcoes: {
    readonly limiteMs?: number;
    readonly intervaloMs?: number;
    readonly descricao?: string;
  } = {},
): Promise<void> {
  const limite = Date.now() + (opcoes.limiteMs ?? ESPERA_MS);
  while (!(await condicao())) {
    if (Date.now() > limite) {
      throw new Error(`condição não atingida a tempo: ${opcoes.descricao ?? '(sem descrição)'}`);
    }
    await pausa(opcoes.intervaloMs ?? INTERVALO_PADRAO_MS);
  }
}

/** Resolve na próxima ocorrência do evento do próprio socket (`connect`, `disconnect`...). */
export function aguardarEvento(
  socket: Socket,
  evento: string,
  limiteMs = ESPERA_MS,
): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const prazo = setTimeout(() => {
      socket.off(evento, aoOcorrer);
      rejeitar(new Error(`sem "${evento}" em ${String(limiteMs)} ms`));
    }, limiteMs);
    function aoOcorrer(): void {
      clearTimeout(prazo);
      resolver();
    }
    socket.once(evento, aoOcorrer);
  });
}

/**
 * Registra a espera do evento ANTES de rodar `acao` (que o provoca) e só então a aguarda. Se a ação
 * lançar, a espera é descartada sem virar rejeição não tratada quando o prazo vencer.
 */
export async function aguardarApos(
  socket: Socket,
  evento: string,
  acao: () => void,
  limiteMs = ESPERA_MS,
): Promise<void> {
  const espera = aguardarEvento(socket, evento, limiteMs);
  try {
    acao();
  } catch (erro) {
    espera.catch(() => undefined);
    throw erro;
  }
  await espera;
}

function resultadoDaConexao(socket: Socket): Promise<string | undefined> {
  return new Promise((resolver, rejeitar) => {
    const prazo = setTimeout(() => {
      limpar();
      rejeitar(new Error('sem connect nem connect_error'));
    }, ESPERA_MS);
    function limpar(): void {
      clearTimeout(prazo);
      socket.off('connect', aoConectar);
      socket.off('connect_error', aoFalhar);
    }
    function aoConectar(): void {
      limpar();
      resolver(undefined);
    }
    function aoFalhar(erro: Error): void {
      limpar();
      resolver(erro.message);
    }
    socket.on('connect', aoConectar);
    socket.on('connect_error', aoFalhar);
  });
}

/** Sockets de um servidor de teste; `fecharTodos` os derruba (o `afterEach` chama). */
export class ColecaoDeSockets {
  private readonly abertos: Socket[] = [];

  constructor(private readonly url: string) {}

  /** Cria o socket e já o conecta, sem esperar o handshake. Sem reconexão automática. */
  abrir(opcoes: OpcoesDoCliente = {}): Socket {
    const extraHeaders: Record<string, string> = { Origin: ORIGEM_DO_TESTE };
    if (opcoes.cookie !== undefined) extraHeaders['Cookie'] = opcoes.cookie;
    const socket = io(this.url, {
      transports: [...(opcoes.transports ?? ['websocket'])],
      extraHeaders,
      reconnection: false,
      forceNew: true,
    });
    this.abertos.push(socket);
    return socket;
  }

  /** Conecta e falha se o handshake for recusado. */
  async conectar(opcoes: OpcoesDoCliente = {}): Promise<Socket> {
    const { socket, erro } = await this.tentar(opcoes);
    if (erro !== undefined) throw new Error(`conexão recusada: ${erro}`);
    return socket;
  }

  /** Conecta e devolve o motivo da recusa, se houve; o socket recusado já vem fechado. */
  async tentar(opcoes: OpcoesDoCliente = {}): Promise<ResultadoDaTentativa> {
    const socket = this.abrir(opcoes);
    const erro = await resultadoDaConexao(socket);
    if (erro !== undefined) socket.close();
    return { socket, erro };
  }

  fecharTodos(): void {
    for (const socket of this.abertos.splice(0)) socket.close();
  }
}

/** `entrar_lote` com o ack validado contra o `AckEntrarLote` do asyncapi. */
export async function entrarNoLote(socket: Socket, loteId: string): Promise<AckDeEntrada> {
  const ack: unknown = await socket.timeout(ESPERA_MS).emitWithAck('entrar_lote', { loteId });
  validarAckDeEntrada(ack);
  return ack as AckDeEntrada;
}

export async function entrarNoLoteComSucesso(
  socket: Socket,
  loteId: string,
): Promise<AckDeSucesso> {
  const ack = await entrarNoLote(socket, loteId);
  if (!ack.sucesso) throw new Error(`entrar_lote recusado: ${ack.erro.codigo}`);
  return ack;
}

/**
 * `entrar_vitrine` não tem ack. O `entrar_lote` inválido que vem depois é processado na ordem e
 * responde `DADOS_INVALIDOS`, o que garante que a entrada já valeu.
 */
export async function entrarNaVitrine(socket: Socket): Promise<void> {
  socket.emit('entrar_vitrine');
  await socket.timeout(ESPERA_MS).emitWithAck('entrar_lote', {});
}

/** Grava todo evento recebido pelo socket, na ordem de chegada. */
export function gravar(socket: Socket): Recebido[] {
  const recebidos: Recebido[] = [];
  socket.onAny((evento: string, payload: unknown) => {
    recebidos.push({ evento, payload, em: performance.now() });
  });
  return recebidos;
}

/** Nomes dos eventos, ordenados (a ordem entre rooms diferentes não é contrato). */
export function nomesDe(recebidos: readonly Recebido[]): string[] {
  return recebidos.map((r) => r.evento).sort();
}

/** O payload como registro, ou `undefined` quando não é um objeto. */
function comoRegistro(payload: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  return Object.fromEntries(Object.entries(payload));
}

/** Só os eventos cujo payload é do lote (salas globais, como a vitrine, recebem de outros testes). */
export function doLote(recebidos: readonly Recebido[], loteId: string): Recebido[] {
  return recebidos.filter((r) => comoRegistro(r.payload)?.['loteId'] === loteId);
}

/** O primeiro evento `evento` cujo payload tem `campo === valor` (ex.: `seq`, `valorCentavos`). */
export function acharEvento(
  recebidos: readonly Recebido[],
  evento: string,
  campo: string,
  valor: string | number,
): Recebido | undefined {
  return recebidos.find((r) => r.evento === evento && comoRegistro(r.payload)?.[campo] === valor);
}

/**
 * Espera o evento aparecer (ver `acharEvento`) e o devolve; nada de índice posicional. Aceita uma
 * função no lugar do array para fontes derivadas (ex.: a vitrine filtrada por lote).
 */
export async function esperarEvento(
  fonte: readonly Recebido[] | (() => readonly Recebido[]),
  evento: string,
  campo: string,
  valor: string | number,
): Promise<Recebido> {
  const recebidos = (): readonly Recebido[] => (typeof fonte === 'function' ? fonte() : fonte);
  const descricao = `${evento} com ${campo}=${String(valor)}`;
  await ate(() => acharEvento(recebidos(), evento, campo, valor) !== undefined, { descricao });
  const achado = acharEvento(recebidos(), evento, campo, valor);
  if (achado === undefined) throw new Error(`evento sumiu depois de chegar: ${descricao}`);
  return achado;
}

/** `seq` de cada `lance_aceito` recebido, na ordem de chegada. */
export function seqsDeLanceAceito(recebidos: readonly Recebido[]): unknown[] {
  return recebidos
    .filter((r) => r.evento === 'lance_aceito')
    .map((r) => comoRegistro(r.payload)?.['seq']);
}
