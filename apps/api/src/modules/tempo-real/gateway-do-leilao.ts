// Gateway Socket.IO do namespace /leilao (specs/009). Só transporte websocket; handshake
// autenticado pelo cookie `access_token` (anônimo = só leitura); rooms `usuario:{id}`, `lote:{id}`
// e `vitrine`; limites de 50 conexões por lote e 200 no total. O ack de `entrar_lote` leva o estado
// do lote (estado-da-sala.ts) e os eventos do barramento saem pela DifusaoDeEventos.
import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { ENV, type Env } from '../../config/env.js';
import { AutenticacaoDoHandshake } from '../identidade/index.js';
import { ADAPTER_REDIS_DO_TEMPO_REAL, type AdapterRedisDoTempoReal } from './adapter-redis.js';
import { DifusaoDeEventos } from './difusao-de-eventos.js';
import { lerLoteRef } from './esquemas.js';
import { type EstadoDaSala, MontadorDoEstado } from './estado-da-sala.js';
import {
  LIMITES_DO_TEMPO_REAL,
  LimiteDeEventos,
  type LimitesDoTempoReal,
  ReservaDeConexoes,
} from './limites.js';
import { PREFIXO_DA_SALA_DO_LOTE, SALA_DA_VITRINE, salaDoLote, salaDoUsuario } from './salas.js';

export const NAMESPACE_DO_LEILAO = '/leilao';

export const MENSAGEM_SERVIDOR_CHEIO = 'SERVIDOR_CHEIO';
export const MENSAGEM_ORIGEM_RECUSADA = 'ORIGEM_NAO_PERMITIDA';

/** Tamanho máximo de um pacote: os payloads do cliente têm um UUID (a lib aceita 1 MB por padrão). */
const TAMANHO_MAXIMO_DO_PACOTE_B = 4_096;

interface DadosDoSocket {
  usuario?: UsuarioDaSessao;
  limiteDeEventos?: LimiteDeEventos;
}

type SocketDoLeilao = Socket<never, never, never, DadosDoSocket>;

/** Forma do erro do ack de `entrar_lote` no AsyncAPI (schema AckEntrarLote, specs/009). */
interface AckDeErro {
  readonly sucesso: false;
  readonly erro: {
    readonly codigo: 'DADOS_INVALIDOS' | 'NAO_ENCONTRADO' | 'SALA_CHEIA' | 'INDISPONIVEL';
    readonly mensagem: string;
  };
}
/** Schema `AckEntrarLote` do asyncapi: erro tipado ou sucesso com o estado atual do lote. */
export type AckDeEntrada = AckDeErro | { readonly sucesso: true; readonly estado: EstadoDaSala };

function erroDeAck(codigo: AckDeErro['erro']['codigo'], mensagem: string): AckDeErro {
  return { sucesso: false, erro: { codigo, mensagem } };
}

@WebSocketGateway({
  namespace: NAMESPACE_DO_LEILAO,
  transports: ['websocket'],
  serveClient: false,
  maxHttpBufferSize: TAMANHO_MAXIMO_DO_PACOTE_B,
})
export class GatewayDoLeilao implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('TempoReal');
  private readonly conexoes: ReservaDeConexoes;

  @WebSocketServer() private namespace!: Namespace;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LIMITES_DO_TEMPO_REAL) private readonly limites: LimitesDoTempoReal,
    @Inject(AutenticacaoDoHandshake) private readonly autenticacao: AutenticacaoDoHandshake,
    @Inject(ADAPTER_REDIS_DO_TEMPO_REAL) private readonly adapterRedis: AdapterRedisDoTempoReal,
    @Inject(MontadorDoEstado) private readonly montador: MontadorDoEstado,
    @Inject(DifusaoDeEventos) private readonly difusao: DifusaoDeEventos,
  ) {
    this.conexoes = new ReservaDeConexoes(limites.total);
  }

  afterInit(namespace: Namespace): void {
    if (this.adapterRedis.fabrica !== undefined) {
      // Reinicializa o adapter de todos os namespaces já criados.
      namespace.server.adapter(this.adapterRedis.fabrica);
    }
    this.difusao.iniciar(namespace);
    namespace.use((socket, proximo) => {
      void this.admitir(socket as SocketDoLeilao, proximo);
    });
  }

  /** Autenticado entra no room privado; o socket chega aqui antes de qualquer evento do cliente. */
  async handleConnection(socket: SocketDoLeilao): Promise<void> {
    const usuario = socket.data.usuario;
    if (usuario === undefined) {
      return;
    }
    try {
      await socket.join(salaDoUsuario(usuario.id));
    } catch (erro: unknown) {
      // Sem o room privado o usuário não receberia `voce_foi_superado` nem `saldo_atualizado`:
      // melhor derrubar e deixar o cliente reconectar do que mantê-lo conectado e mudo.
      this.registrarFalha('room_do_usuario', erro);
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('entrar_lote')
  async entrarLote(
    @ConnectedSocket() socket: SocketDoLeilao,
    @MessageBody() payload: unknown,
  ): Promise<AckDeEntrada> {
    if (!this.eventoPermitido(socket, 'entrar_lote')) {
      return erroDeAck('INDISPONIVEL', 'Muitas solicitações em pouco tempo. Aguarde um instante.');
    }
    const loteId = lerLoteRef(payload);
    if (loteId === undefined) {
      return erroDeAck('DADOS_INVALIDOS', 'Informe o loteId (UUID) e nenhum outro campo.');
    }
    const sala = salaDoLote(loteId);
    const jaEstaNaSala = socket.rooms.has(sala);
    try {
      // Sem `await` entre as contagens e o join: entradas simultâneas não furam os limites.
      if (!jaEstaNaSala && this.salasDeLoteDoSocket(socket) >= this.limites.salasDeLotePorSocket) {
        // O AsyncAPI não tem código próprio para este teto (SALA_CHEIA é o limite por lote).
        return erroDeAck('DADOS_INVALIDOS', 'Você já acompanha o máximo de lotes ao mesmo tempo.');
      }
      if (!jaEstaNaSala && this.ocupacaoDaSala(sala) >= this.limites.porLote) {
        return erroDeAck('SALA_CHEIA', 'A sala deste lote está cheia. Tente novamente mais tarde.');
      }
      // Entra antes de ler o estado: um lance confirmado depois da leitura chega por evento, e
      // nenhum se perde entre a leitura e a entrada. Se o ack for de erro, o socket sai do room.
      await socket.join(sala);
      const estado = await this.montador.montar(loteId, socket.data.usuario?.id);
      if (estado === null) {
        await this.desfazerEntrada(socket, sala, jaEstaNaSala);
        return erroDeAck('NAO_ENCONTRADO', 'Lote não encontrado.');
      }
      return { sucesso: true, estado };
    } catch (erro: unknown) {
      this.registrarFalha('entrar_lote', erro);
      await this.desfazerEntrada(socket, sala, jaEstaNaSala);
      return erroDeAck('INDISPONIVEL', 'Não foi possível entrar na sala agora. Tente novamente.');
    }
  }

  /** Tira do room só quem entrou nesta chamada (um resync que falha não derruba a sala atual). */
  private async desfazerEntrada(
    socket: SocketDoLeilao,
    sala: string,
    jaEstavaNaSala: boolean,
  ): Promise<void> {
    if (jaEstavaNaSala) return;
    await this.sairDaSala(socket, sala, 'entrar_lote');
  }

  @SubscribeMessage('sair_lote')
  async sairLote(
    @ConnectedSocket() socket: SocketDoLeilao,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    if (!this.eventoPermitido(socket, 'sair_lote')) {
      return;
    }
    const loteId = lerLoteRef(payload);
    if (loteId === undefined) {
      this.logger.warn('sair_lote ignorado: payload inválido');
      return;
    }
    await this.sairDaSala(socket, salaDoLote(loteId), 'sair_lote');
  }

  @SubscribeMessage('entrar_vitrine')
  async entrarVitrine(@ConnectedSocket() socket: SocketDoLeilao): Promise<void> {
    if (!this.eventoPermitido(socket, 'entrar_vitrine')) {
      return;
    }
    try {
      await socket.join(SALA_DA_VITRINE);
    } catch (erro: unknown) {
      this.registrarFalha('entrar_vitrine', erro);
    }
  }

  @SubscribeMessage('sair_vitrine')
  async sairVitrine(@ConnectedSocket() socket: SocketDoLeilao): Promise<void> {
    if (!this.eventoPermitido(socket, 'sair_vitrine')) {
      return;
    }
    await this.sairDaSala(socket, SALA_DA_VITRINE, 'sair_vitrine');
  }

  private async sairDaSala(socket: SocketDoLeilao, sala: string, evento: string): Promise<void> {
    try {
      await socket.leave(sala);
    } catch (erro: unknown) {
      this.registrarFalha(evento, erro);
    }
  }

  private ocupacaoDaSala(sala: string): number {
    return this.namespace.adapter.rooms.get(sala)?.size ?? 0;
  }

  /** Rooms de lote em que o socket está agora (o room do próprio id, `usuario:` e `vitrine` não contam). */
  private salasDeLoteDoSocket(socket: SocketDoLeilao): number {
    let total = 0;
    for (const sala of socket.rooms) {
      if (sala.startsWith(PREFIXO_DA_SALA_DO_LOTE)) {
        total += 1;
      }
    }
    return total;
  }

  /**
   * Conta o evento no limite por segundo do socket. Acima dele, o evento é descartado (com ack de
   * erro, onde há ack); só a primeira recusa de cada socket vai para o log, sem payload.
   */
  private eventoPermitido(socket: SocketDoLeilao, evento: string): boolean {
    const limite = socket.data.limiteDeEventos;
    if (limite === undefined || limite.permitir(performance.now())) {
      return true;
    }
    if (limite.totalRecusado === 1) {
      this.logger.warn(`eventos acima do limite por segundo (${evento})`);
    }
    return false;
  }

  /**
   * Vaga entre as 200 de um socket do namespace. Uma mesma conexão do engine pode abrir e fechar o
   * namespace várias vezes, então a vaga acompanha o socket (`disconnect`), não só o engine. O
   * `close` do engine fica como segurança para o handshake que não termina (o socket nunca chega a
   * `connected` e não emite `disconnect`). A liberação é idempotente e remove os dois listeners.
   */
  private reservarVaga(socket: SocketDoLeilao): (() => void) | undefined {
    const liberarVaga = this.conexoes.reservar();
    if (liberarVaga === undefined) {
      return undefined;
    }
    const liberar = (): void => {
      liberarVaga();
      socket.conn.off('close', liberar);
      socket.off('disconnect', liberar);
    };
    socket.conn.once('close', liberar);
    socket.once('disconnect', liberar);
    return liberar;
  }

  /**
   * Middleware do namespace: origem, vaga entre as 200 e sessão, nessa ordem. A vaga é reservada
   * antes do `await` da sessão e liberada quando o socket desconecta, quando a conexão do engine
   * fecha (inclusive se o cliente desistir no meio do handshake) ou se o handshake for recusado.
   */
  private async admitir(socket: SocketDoLeilao, proximo: (erro?: Error) => void): Promise<void> {
    if (socket.handshake.headers.origin !== this.env.WEB_ORIGIN) {
      proximo(new Error(MENSAGEM_ORIGEM_RECUSADA));
      return;
    }
    const liberar = this.reservarVaga(socket);
    if (liberar === undefined) {
      proximo(new Error(MENSAGEM_SERVIDOR_CHEIO));
      return;
    }
    socket.data.limiteDeEventos = new LimiteDeEventos(this.limites.eventosPorJanela);
    try {
      const usuario = await this.autenticacao.autenticarCookie(socket.handshake.headers.cookie);
      if (usuario !== undefined) {
        socket.data.usuario = usuario;
      }
      proximo();
    } catch (erro: unknown) {
      liberar();
      this.registrarFalha('handshake', erro);
      proximo(new Error('INDISPONIVEL'));
    }
  }

  /** Só o nome do evento e o do erro: nada do payload, do cookie nem do usuário. */
  private registrarFalha(evento: string, erro: unknown): void {
    const nome = erro instanceof Error ? erro.name : 'ErroDesconhecido';
    this.logger.error(`falha em ${evento} (${nome})`);
  }
}
