// Acumula os eventos de uma transação e só os publica se ela confirmar (specs/009): no rollback
// (a função lança), os eventos são descartados e o erro segue para quem chamou.
import type { EventoDeDominio, PublicadorDeEventos } from './publicador-de-eventos.js';

export interface ColetorDeEventos {
  /** Guarda o evento para publicar depois do COMMIT. */
  agendar(evento: EventoDeDominio): void;
}

/**
 * Executa `transacao` (que deve conter o `db.transaction(...)` inteiro, de modo que ela só
 * resolva depois do COMMIT) e, se resolver, publica os eventos agendados, na ordem. Se lançar,
 * não publica nada.
 */
export async function aposCommit<Resultado>(
  publicador: PublicadorDeEventos,
  transacao: (coletor: ColetorDeEventos) => Promise<Resultado>,
): Promise<Resultado> {
  const pendentes: EventoDeDominio[] = [];
  const coletor: ColetorDeEventos = {
    agendar: (evento) => {
      pendentes.push(evento);
    },
  };
  const resultado = await transacao(coletor);
  for (const evento of pendentes) {
    publicador.publicar(evento);
  }
  return resultado;
}
