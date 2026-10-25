// Barramento interno de eventos de domínio (specs/009). Publica só depois do COMMIT (quem chama
// decide quando; ver ./apos-commit.ts). O erro de um assinante é capturado e logado sem dado
// sensível (só o tipo do evento e o nome do erro) e nunca chega a quem publicou nem aos demais
// assinantes: o lance já confirmou.
import { EventEmitter } from 'node:events';

import type { EventosDoServidor } from '@leilao/contracts';

export type TipoDeEvento = keyof EventosDoServidor;

/**
 * Evento de domínio: o tipo é o nome do evento do asyncapi e o payload é o do contrato.
 * `usuarioId` é o destinatário dos eventos privados (room `usuario:{id}`, specs/009); fica fora
 * do payload, que não leva dado de usuário (D8). Eventos públicos não têm destinatário.
 */
export type EventoDeDominio = {
  [Tipo in TipoDeEvento]: {
    readonly tipo: Tipo;
    readonly payload: EventosDoServidor[Tipo];
    readonly usuarioId?: string;
  };
}[TipoDeEvento];

/** Para quem o evento vai: vazio nos públicos; `usuarioId` nos privados. */
export interface DestinoDoEvento {
  readonly usuarioId?: string;
}

export type AssinanteDeEvento<Tipo extends TipoDeEvento> = (
  payload: EventosDoServidor[Tipo],
  destino: DestinoDoEvento,
) => void | Promise<void>;

/** Destino do aviso de falha de assinante. Nunca recebe o payload nem a mensagem do erro. */
export interface RegistroDeFalhaDeAssinante {
  falhaDeAssinante(tipo: TipoDeEvento, erro: unknown): void;
}

export class PublicadorDeEventos {
  private readonly emissor = new EventEmitter();

  constructor(private readonly registro: RegistroDeFalhaDeAssinante) {
    // Muitos assinantes legítimos por evento (sala, saldo, notificações): sem limite de aviso.
    this.emissor.setMaxListeners(0);
  }

  /** Entrega o evento a todos os assinantes, na ordem de registro. Nunca lança. */
  publicar(evento: EventoDeDominio): void {
    const destino: DestinoDoEvento = Object.freeze(
      evento.usuarioId === undefined ? {} : { usuarioId: evento.usuarioId },
    );
    this.emissor.emit(evento.tipo, evento.payload, destino);
  }

  /** Registra um assinante; devolve a função que o remove. */
  aoOcorrer<Tipo extends TipoDeEvento>(tipo: Tipo, assinante: AssinanteDeEvento<Tipo>): () => void {
    const protegido = (payload: EventosDoServidor[Tipo], destino: DestinoDoEvento): void => {
      try {
        const resultado = assinante(payload, destino);
        if (resultado instanceof Promise) {
          resultado.catch((erro: unknown) => {
            this.registrarFalha(tipo, erro);
          });
        }
      } catch (erro) {
        this.registrarFalha(tipo, erro);
      }
    };
    this.emissor.on(tipo, protegido);
    return () => {
      this.emissor.off(tipo, protegido);
    };
  }

  private registrarFalha(tipo: TipoDeEvento, erro: unknown): void {
    try {
      this.registro.falhaDeAssinante(tipo, erro);
    } catch {
      // O próprio registro falhou: não há mais onde avisar, e não pode afetar o publicador.
    }
  }
}
