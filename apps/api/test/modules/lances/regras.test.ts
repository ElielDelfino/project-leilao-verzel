// Unidade: regras puras do lance (specs/007 §Transação passos 3 e 7, §Eventos; ADR 0031 D10) e a
// tradução das falhas da transação (55P03 → 503, nunca 500; ErroDeCarteira sem vazar o objeto).
import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import { ErroDoBanco } from '../../../src/db/banco.js';
import { ErroDeCarteira } from '../../../src/modules/carteira/index.js';
import {
  eventosDoLance,
  fimDepoisDoLance,
  minimoDoLance,
  recusaDoLance,
  traduzirFalhaDoLance,
  traduzirRecusaDeSaldo,
} from '../../../src/modules/lances/regras.js';

const MIN = 60_000;
const AGORA = new Date('2026-10-27T14:00:00.000Z');
const em = (deltaMs: number): Date => new Date(AGORA.getTime() + deltaMs);
const USUARIO = '0192f000-0000-7000-8000-000000000001';
const OUTRO = '0192f000-0000-7000-8000-000000000002';

const loteAoVivo = {
  status: 'ao_vivo' as const,
  inicioEm: em(-60 * MIN),
  fimEm: em(60 * MIN),
  lanceInicialCentavos: 1000,
  incrementoMinimoCentavos: 100,
  lanceAtualCentavos: null,
  liderId: null,
};

function codigoDe(erro: unknown): string | undefined {
  return erro instanceof ErroApi ? erro.codigo : undefined;
}

describe('minimoDoLance', () => {
  it('sem lance: o lance inicial', () => {
    expect(minimoDoLance(loteAoVivo)).toBe(1000);
  });

  it('com lance: lance atual + incremento', () => {
    expect(minimoDoLance({ ...loteAoVivo, lanceAtualCentavos: 1500, liderId: OUTRO })).toBe(1600);
  });
});

describe('recusaDoLance (ordem de specs/007 §Transação passo 3)', () => {
  it('lote ao vivo, valor no mínimo: sem recusa', () => {
    expect(recusaDoLance(loteAoVivo, AGORA, USUARIO, 1000)).toBeNull();
  });

  it('cancelado → LOTE_ENCERRADO, mesmo dentro do horário', () => {
    const recusa = recusaDoLance({ ...loteAoVivo, status: 'cancelado' }, AGORA, USUARIO, 1000);
    expect(codigoDe(recusa)).toBe('LOTE_ENCERRADO');
    expect(recusa?.status).toBe(422);
  });

  it('agora = fim_em → LOTE_ENCERRADO (agora ≥ fim)', () => {
    expect(codigoDe(recusaDoLance({ ...loteAoVivo, fimEm: AGORA }, AGORA, USUARIO, 1000))).toBe(
      'LOTE_ENCERRADO',
    );
  });

  it('agora < inicio_em → LOTE_NAO_INICIADO', () => {
    const lote = { ...loteAoVivo, status: 'agendado' as const, inicioEm: em(1) };
    expect(codigoDe(recusaDoLance(lote, AGORA, USUARIO, 1000))).toBe('LOTE_NAO_INICIADO');
  });

  it('agora = inicio_em: já começou', () => {
    expect(recusaDoLance({ ...loteAoVivo, inicioEm: AGORA }, AGORA, USUARIO, 1000)).toBeNull();
  });

  it('o status gravado não decide: "encerrado" gravado com horário aberto aceita', () => {
    expect(recusaDoLance({ ...loteAoVivo, status: 'encerrado' }, AGORA, USUARIO, 1000)).toBeNull();
  });

  it('líder = usuário → JA_ESTA_GANHANDO, antes do mínimo', () => {
    const lote = { ...loteAoVivo, lanceAtualCentavos: 1500, liderId: USUARIO };
    expect(codigoDe(recusaDoLance(lote, AGORA, USUARIO, 1))).toBe('JA_ESTA_GANHANDO');
  });

  it('abaixo do mínimo → LANCE_ABAIXO_DO_MINIMO com detalhes.minimoCentavos', () => {
    const lote = { ...loteAoVivo, lanceAtualCentavos: 1500, liderId: OUTRO };
    const recusa = recusaDoLance(lote, AGORA, USUARIO, 1599);
    expect(codigoDe(recusa)).toBe('LANCE_ABAIXO_DO_MINIMO');
    expect(recusa?.detalhes).toEqual({ minimoCentavos: 1600 });
  });

  it('encerrado vem antes de não iniciado e de líder', () => {
    const lote = { ...loteAoVivo, status: 'cancelado' as const, inicioEm: em(1), liderId: USUARIO };
    expect(codigoDe(recusaDoLance(lote, AGORA, USUARIO, 1))).toBe('LOTE_ENCERRADO');
  });
});

describe('fimDepoisDoLance (anti-sniping, ADR 0031 D10)', () => {
  it('a 1 min do fim: estende para agora + 2 min', () => {
    expect(fimDepoisDoLance(em(MIN), AGORA)).toEqual(em(2 * MIN));
  });

  it('a exatamente 2 min: não estende', () => {
    expect(fimDepoisDoLance(em(2 * MIN), AGORA)).toBeUndefined();
  });

  it('a 2 min menos 1 ms: estende', () => {
    expect(fimDepoisDoLance(em(2 * MIN - 1), AGORA)).toEqual(em(2 * MIN));
  });

  it('a 3 min: não estende', () => {
    expect(fimDepoisDoLance(em(3 * MIN), AGORA)).toBeUndefined();
  });
});

describe('traduzirRecusaDeSaldo', () => {
  it('SALDO_INSUFICIENTE → 422 com só detalhes.disponivelCentavos', () => {
    const erro = traduzirRecusaDeSaldo(
      new ErroDeCarteira('SALDO_INSUFICIENTE', { valor: 5000, disponivel: 1200 }),
    );
    expect(codigoDe(erro)).toBe('SALDO_INSUFICIENTE');
    expect((erro as ErroApi).status).toBe(422);
    expect((erro as ErroApi).detalhes).toEqual({ disponivelCentavos: 1200 });
  });

  it('outro erro volta como veio', () => {
    const outro = new ErroDeCarteira('LANCE_JA_PROCESSADO');
    expect(traduzirRecusaDeSaldo(outro)).toBe(outro);
    const generico = new Error('x');
    expect(traduzirRecusaDeSaldo(generico)).toBe(generico);
  });
});

describe('traduzirFalhaDoLance (nunca 500 cru)', () => {
  const doBanco = (codigo: string, restricao?: string): ErroDoBanco =>
    new ErroDoBanco({ codigo, restricao, tabela: undefined, coluna: undefined });

  it.each(['55P03', '40P01'])('SQLSTATE %s → 503 INDISPONIVEL', (codigo) => {
    const erro = traduzirFalhaDoLance(doBanco(codigo));
    expect(codigoDe(erro)).toBe('INDISPONIVEL');
    expect((erro as ErroApi).status).toBe(503);
  });

  it('chave repetida em outro lote, em paralelo (unique de bids) → 422 DADOS_INVALIDOS', () => {
    const erro = traduzirFalhaDoLance(doBanco('23505', 'bids_licitante_id_idempotency_key_unique'));
    expect(codigoDe(erro)).toBe('DADOS_INVALIDOS');
    expect((erro as ErroApi).status).toBe(422);
  });

  it.each([
    new ErroDeCarteira('LANCE_JA_PROCESSADO'),
    new ErroDeCarteira('COMPROMETIDO_INSUFICIENTE', { valor: 10, comprometido: 0 }),
    new ErroDeCarteira('SALDO_INSUFICIENTE', { valor: 10, disponivel: 0 }),
  ])('ErroDeCarteira que escapou ($codigo) → 503 sem detalhes', (falha) => {
    const erro = traduzirFalhaDoLance(falha);
    expect(codigoDe(erro)).toBe('INDISPONIVEL');
    expect((erro as ErroApi).status).toBe(503);
    expect((erro as ErroApi).detalhes).toBeUndefined();
  });

  it('ErroApi e erros desconhecidos voltam como vieram', () => {
    const api = new ErroApi({ codigo: 'JA_ESTA_GANHANDO', status: 422, mensagem: 'x' });
    expect(traduzirFalhaDoLance(api)).toBe(api);
    const outro = doBanco('23503');
    expect(traduzirFalhaDoLance(outro)).toBe(outro);
  });
});

describe('eventosDoLance (specs/007 §Eventos, payloads do asyncapi)', () => {
  const base = {
    loteId: '0192f000-0000-7000-8000-0000000000aa',
    lance: {
      seq: 2,
      pseudonimo: 'Licitante #b04e7d',
      valorCentavos: 1600,
      criadoEm: '2026-10-27T14:00:00.000Z',
    },
    fimAntes: em(60 * MIN),
    fimDepois: em(60 * MIN),
    totalLances: 2,
    novoLider: {
      id: USUARIO,
      saldo: { totalCentavos: 5000, comprometidoCentavos: 1600, disponivelCentavos: 3400 },
    },
  };

  it('lance com líder anterior e sem extensão: lance_aceito público; privados por usuário', () => {
    const eventos = eventosDoLance({
      ...base,
      liderAnterior: {
        id: OUTRO,
        saldo: { totalCentavos: 2000, comprometidoCentavos: 0, disponivelCentavos: 2000 },
      },
    });

    expect(eventos.publicos).toEqual([
      {
        tipo: 'lance_aceito',
        payload: {
          loteId: base.loteId,
          seq: 2,
          pseudonimo: 'Licitante #b04e7d',
          valorCentavos: 1600,
          criadoEm: '2026-10-27T14:00:00.000Z',
          fimEm: base.fimDepois.toISOString(),
          totalLances: 2,
        },
      },
    ]);
    expect(eventos.privados).toEqual([
      {
        usuarioId: OUTRO,
        tipo: 'voce_foi_superado',
        payload: { loteId: base.loteId, valorCentavos: 1600 },
      },
      { usuarioId: USUARIO, tipo: 'saldo_atualizado', payload: base.novoLider.saldo },
      {
        usuarioId: OUTRO,
        tipo: 'saldo_atualizado',
        payload: { totalCentavos: 2000, comprometidoCentavos: 0, disponivelCentavos: 2000 },
      },
    ]);
    for (const publico of eventos.publicos) expect(publico).not.toHaveProperty('usuarioId');
  });

  it('líder anterior igual ao licitante (defensivo): sem voce_foi_superado e um saldo só', () => {
    const eventos = eventosDoLance({ ...base, liderAnterior: base.novoLider });

    expect(eventos.privados).toEqual([
      { usuarioId: USUARIO, tipo: 'saldo_atualizado', payload: base.novoLider.saldo },
    ]);
  });

  it('primeiro lance com extensão: fim_estendido, sem voce_foi_superado', () => {
    const eventos = eventosDoLance({ ...base, fimDepois: em(61 * MIN), liderAnterior: null });

    expect(eventos.publicos.map((e) => e.tipo)).toEqual(['lance_aceito', 'fim_estendido']);
    expect(eventos.publicos[1]).toEqual({
      tipo: 'fim_estendido',
      payload: { loteId: base.loteId, fimEm: em(61 * MIN).toISOString() },
    });
    expect(eventos.privados).toEqual([
      { usuarioId: USUARIO, tipo: 'saldo_atualizado', payload: base.novoLider.saldo },
    ]);
  });
});
