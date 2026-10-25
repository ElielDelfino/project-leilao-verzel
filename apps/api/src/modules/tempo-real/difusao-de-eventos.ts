// Ponte do barramento interno (common/eventos) para os rooms do Socket.IO (specs/009 §Interfaces
// e contratos). O barramento só entrega depois do COMMIT (aposCommit); aqui só se escolhe o room:
// - públicos (`lance_aceito`, `fim_estendido` e os de lote da F4) → `lote:{loteId}` e `vitrine`,
//   nunca `usuario:`;
// - privados (`voce_foi_superado`, `saldo_atualizado`, `lote_arrematado`) → só `usuario:{id}` do
//   destinatário; sem destinatário, o evento é descartado (nunca difundido) e logado sem dados.
// O payload emitido é uma cópia só com os campos do asyncapi: um campo a mais vindo do domínio
// (um id de usuário, por exemplo) nunca chega ao cliente. O assinante nunca lança.
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { EventosDoServidor } from '@leilao/contracts';

import {
  type DestinoDoEvento,
  PublicadorDeEventos,
  type TipoDeEvento,
} from '../../common/eventos/publicador-de-eventos.js';
import { SALA_DA_VITRINE, salaDoLote, salaDoUsuario } from './salas.js';

/** Campos de cada payload no asyncapi 0.3.0, na ordem do contrato. */
export const CAMPOS_DOS_EVENTOS = {
  lance_aceito: [
    'loteId',
    'seq',
    'pseudonimo',
    'valorCentavos',
    'criadoEm',
    'fimEm',
    'totalLances',
  ],
  fim_estendido: ['loteId', 'fimEm'],
  lote_iniciado: ['loteId'],
  lote_encerrado: ['loteId', 'vencedorPseudonimo', 'valorArremateCentavos'],
  lote_cancelado: ['loteId'],
  voce_foi_superado: ['loteId', 'valorCentavos'],
  saldo_atualizado: ['totalCentavos', 'comprometidoCentavos', 'disponivelCentavos'],
  lote_arrematado: ['loteId', 'codigoComprovante'],
} as const satisfies { readonly [T in TipoDeEvento]: readonly (keyof EventosDoServidor[T])[] };

export type TipoPublico =
  'lance_aceito' | 'fim_estendido' | 'lote_iniciado' | 'lote_encerrado' | 'lote_cancelado';
export type TipoPrivado = Exclude<TipoDeEvento, TipoPublico>;

export const EVENTOS_PUBLICOS: readonly TipoPublico[] = [
  'lance_aceito',
  'fim_estendido',
  'lote_iniciado',
  'lote_encerrado',
  'lote_cancelado',
];
export const EVENTOS_PRIVADOS: readonly TipoPrivado[] = [
  'voce_foi_superado',
  'saldo_atualizado',
  'lote_arrematado',
];

/** O que a difusão usa do namespace (o `Namespace` do socket.io cumpre). */
export interface EmissorDeSalas {
  to(salas: string | string[]): { emit(evento: string, payload: unknown): unknown };
}

/** Cópia só com os campos do contrato; campo ausente (opcional) fica ausente. */
export function projetarPayload<T extends TipoDeEvento>(
  tipo: T,
  payload: EventosDoServidor[T],
): Partial<EventosDoServidor[T]> {
  const origem = payload as Readonly<Record<string, unknown>>;
  const copia: Record<string, unknown> = {};
  for (const campo of CAMPOS_DOS_EVENTOS[tipo] as readonly string[]) {
    if (origem[campo] !== undefined) copia[campo] = origem[campo];
  }
  return copia as Partial<EventosDoServidor[T]>;
}

@Injectable()
export class DifusaoDeEventos implements OnModuleDestroy {
  private readonly logger = new Logger('TempoReal');
  private cancelamentos: readonly (() => void)[] = [];

  constructor(@Inject(PublicadorDeEventos) private readonly publicador: PublicadorDeEventos) {}

  /** Assina os oito eventos do contrato e difunde no `emissor`. Chamar uma vez (afterInit). */
  iniciar(emissor: EmissorDeSalas): void {
    this.encerrar();
    const publicos = EVENTOS_PUBLICOS.map((tipo) =>
      this.publicador.aoOcorrer(tipo, (payload) => {
        this.difundirPublico(emissor, tipo, payload);
      }),
    );
    const privados = EVENTOS_PRIVADOS.map((tipo) =>
      this.publicador.aoOcorrer(tipo, (payload, destino) => {
        this.difundirPrivado(emissor, tipo, payload, destino);
      }),
    );
    this.cancelamentos = [...publicos, ...privados];
  }

  onModuleDestroy(): void {
    this.encerrar();
  }

  private encerrar(): void {
    for (const cancelar of this.cancelamentos) cancelar();
    this.cancelamentos = [];
  }

  private difundirPublico<T extends TipoPublico>(
    emissor: EmissorDeSalas,
    tipo: T,
    payload: EventosDoServidor[T],
  ): void {
    try {
      const loteId = payload.loteId.toLowerCase();
      // Uma emissão para os dois rooms: quem está nos dois recebe uma vez só.
      emissor.to([salaDoLote(loteId), SALA_DA_VITRINE]).emit(tipo, projetarPayload(tipo, payload));
    } catch (erro: unknown) {
      this.registrarFalha(tipo, erro);
    }
  }

  private difundirPrivado<T extends TipoPrivado>(
    emissor: EmissorDeSalas,
    tipo: T,
    payload: EventosDoServidor[T],
    destino: DestinoDoEvento,
  ): void {
    try {
      if (destino.usuarioId === undefined || destino.usuarioId === '') {
        this.logger.warn(`evento privado ${tipo} sem destinatário: descartado`);
        return;
      }
      emissor.to(salaDoUsuario(destino.usuarioId)).emit(tipo, projetarPayload(tipo, payload));
    } catch (erro: unknown) {
      this.registrarFalha(tipo, erro);
    }
  }

  /** Só o tipo do evento e o nome do erro: nada do payload nem do destinatário. */
  private registrarFalha(tipo: TipoDeEvento, erro: unknown): void {
    const nome = erro instanceof Error ? erro.name : 'ErroDesconhecido';
    this.logger.error(`falha ao difundir ${tipo} (${nome})`);
  }
}
