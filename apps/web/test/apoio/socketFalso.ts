import type { SocketDoApp } from '../../src/tempo-real/contexto';

type Ouvinte = (...args: never[]) => void;

/** Servidor Socket.IO falso: guarda ouvintes e emissões, e dispara eventos como o servidor faria. */
export class SocketFalso implements SocketDoApp {
  connected = false;
  fechado = false;
  readonly emitidos: { evento: string; args: unknown[] }[] = [];
  private readonly ouvintes = new Map<string, Set<Ouvinte>>();

  on(evento: string, ouvinte: Ouvinte): this {
    const conjunto = this.ouvintes.get(evento) ?? new Set<Ouvinte>();
    conjunto.add(ouvinte);
    this.ouvintes.set(evento, conjunto);
    return this;
  }

  off(evento: string, ouvinte?: Ouvinte): this {
    if (ouvinte) this.ouvintes.get(evento)?.delete(ouvinte);
    else this.ouvintes.delete(evento);
    return this;
  }

  emit(evento: string, ...args: unknown[]): this {
    this.emitidos.push({ evento, args });
    return this;
  }

  close(): this {
    // A fábrica do teste devolve sempre a mesma instância (o StrictMode monta duas vezes), então
    // `close` só registra o fechamento e não derruba `connected`.
    this.fechado = true;
    return this;
  }

  /** Eventos que o cliente emitiu, na ordem. */
  nomesEmitidos(): string[] {
    return this.emitidos.map((e) => e.evento);
  }

  /** Quantos ouvintes (de todos os eventos) ainda estão registrados. */
  totalDeOuvintes(): number {
    return [...this.ouvintes.values()].reduce((soma, c) => soma + c.size, 0);
  }

  /** Simula o servidor entregando um evento (ou `connect`/`disconnect`) ao cliente. */
  receber(evento: string, payload?: unknown): void {
    if (evento === 'connect') this.connected = true;
    if (evento === 'disconnect') this.connected = false;
    for (const ouvinte of [...(this.ouvintes.get(evento) ?? [])]) {
      (ouvinte as (p?: unknown) => void)(payload);
    }
  }
}
