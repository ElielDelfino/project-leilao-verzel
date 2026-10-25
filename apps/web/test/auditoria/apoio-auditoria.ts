import { http, HttpResponse, type HttpHandler } from 'msw';

import type { Auditoria, ChavePublica } from '../../src/api/auditoria';
import fixture from './verificador/fixtures/cadeia-da-api.json';
import { ORIGEM } from '../apoio/servidor';

// Cadeias geradas com o código real da API (mesma fixture do verificador da tarefa 113).
export const LOTE_ID: string = fixture.loteId;

interface CasoDaFixture {
  nome: string;
  lances: Auditoria['lances'];
  selo: Auditoria['selo'];
  servidor: { veredito: Auditoria['veredito']; problemas: Auditoria['problemas'] };
}

const CASOS = fixture.casos as CasoDaFixture[];

export const CHAVES: ChavePublica[] = fixture.chaves.map((chave) => ({
  ...chave,
  algoritmo: 'Ed25519' as const,
  ativaDesde: '2026-10-24T00:00:00.000Z',
}));

export const KEY_ID: string = fixture.chaves[0]?.keyId ?? '';

export function casoDaFixture(nome: string): CasoDaFixture {
  const caso = CASOS.find((c) => c.nome === nome);
  if (caso === undefined) throw new Error(`fixture sem o caso ${nome}`);
  return caso;
}

/** Auditoria como o servidor a publicaria para o caso; `sobrescrever` força um veredito diferente. */
export function auditoriaDoCaso(
  nome: string,
  sobrescrever: Partial<Pick<Auditoria, 'veredito' | 'problemas'>> = {},
): Auditoria {
  const caso = casoDaFixture(nome);
  return {
    lote: {
      id: LOTE_ID,
      titulo: 'Black Lotus',
      cartaNome: 'Black Lotus',
      status: caso.selo === null ? 'ao_vivo' : 'encerrado',
      inicioEm: '2026-10-27T14:00:00.000Z',
      fimEm: '2026-10-27T14:30:00.000Z',
      totalLances: caso.lances.length,
    },
    lances: caso.lances,
    selo: caso.selo,
    veredito: caso.servidor.veredito,
    problemas: caso.servidor.problemas,
    ...sobrescrever,
  };
}

export function servirAuditoria(auditoria: Auditoria): HttpHandler {
  return http.get(`${ORIGEM}/api/auditoria/lotes/:id`, () =>
    HttpResponse.json({ sucesso: true, dados: auditoria }),
  );
}

export function servirChaves(
  chaves: ChavePublica[] = CHAVES,
  contador?: { n: number },
): HttpHandler {
  return http.get(`${ORIGEM}/api/auditoria/chaves`, () => {
    if (contador) contador.n += 1;
    return HttpResponse.json({ sucesso: true, dados: chaves });
  });
}
