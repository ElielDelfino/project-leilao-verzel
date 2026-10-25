// Fixtures geradas com o código real da API (derivarChaves, hashDoLance, assinar, verificarCadeia):
// o veredito e os problemas do navegador devem ser os do servidor, código e seq, na mesma ordem.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ChavePublicada,
  ErroDeCanonico,
  ErroDeContextoInseguro,
  type LanceDaCadeia,
  type Problema,
  type SeloDoLote,
  verificarCadeia,
} from '../../../src/auditoria/verificador';
import fixture from './fixtures/cadeia-da-api.json';

interface Caso {
  nome: string;
  lances: LanceDaCadeia[];
  selo: SeloDoLote | null;
  servidor: { veredito: string; problemas: Problema[] };
}

const LOTE: string = fixture.loteId;
const CHAVES: ChavePublicada[] = fixture.chaves;
const CASOS = fixture.casos as Caso[];
const KEY_ID: string = CHAVES[0]?.keyId ?? '';

function caso(nome: string): Caso {
  const achado = CASOS.find((c) => c.nome === nome);
  if (achado === undefined) throw new Error(`fixture sem o caso ${nome}`);
  return achado;
}

async function concluir(c: Caso, chaves = CHAVES) {
  // Segunda tentativa (chaves já atualizadas): como o servidor, `keyId` ausente é acusado.
  const resultado = await verificarCadeia({
    loteId: LOTE,
    lances: c.lances,
    selo: c.selo,
    chaves,
    chavesAtualizadas: true,
  });
  if (resultado.tipo !== 'concluida') throw new Error('verificação pendente');
  return resultado;
}

const resumo = (problemas: readonly Problema[]) =>
  problemas.map((p) => `${p.codigo}:${p.seq ?? 'null'}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mesmo resultado do servidor (fixture da API real)', () => {
  it.each(CASOS.map((c) => [c.nome, c] as const))('%s', async (_nome, c) => {
    const resultado = await concluir(c);

    expect(resultado.veredito).toBe(c.servidor.veredito);
    expect(resultado.problemas).toEqual(c.servidor.problemas);
  });
});

describe('uma adulteração por vez (specs/008 §Critérios de aceite)', () => {
  it.each([
    ['integro-ao-vivo', 'integro', []],
    ['integro-selado', 'integro', []],
    ['selado-sem-lances', 'integro', []],
    ['valor-alterado', 'adulterado', ['HASH_DIVERGENTE:2']],
    [
      'lance-do-meio-apagado',
      'adulterado',
      ['SEQ_FORA_DE_ORDEM:3', 'HASH_ANTERIOR_DIVERGENTE:3', 'SELO_TOTAL_DIVERGENTE:null'],
    ],
    [
      'lance-inserido',
      'adulterado',
      ['CHAVE_DESCONHECIDA:4', 'SELO_TOTAL_DIVERGENTE:null', 'SELO_HASH_FINAL_DIVERGENTE:null'],
    ],
    [
      'cadeia-recalculada-sem-a-chave',
      'adulterado',
      ['ASSINATURA_INVALIDA:1', 'ASSINATURA_INVALIDA:2', 'ASSINATURA_INVALIDA:3'],
    ],
    [
      'fim-truncado-em-lote-selado',
      'adulterado',
      ['SELO_TOTAL_DIVERGENTE:null', 'SELO_HASH_FINAL_DIVERGENTE:null'],
    ],
  ])('%s → %s', async (nome, veredito, esperados) => {
    const resultado = await concluir(caso(nome));

    expect(resultado.veredito).toBe(veredito);
    expect(resumo(resultado.problemas)).toEqual(esperados);
  });

  it('alterar o selo também é detectado', async () => {
    const base = caso('integro-selado');
    if (base.selo === null) throw new Error('fixture sem selo');
    const selo = { ...base.selo, valorArremateCentavos: 1 };

    const resultado = await concluir({ ...base, selo });

    expect(resumo(resultado.problemas)).toEqual(['SELO_ASSINATURA_INVALIDA:null']);
  });

  it('assinatura malformada é inválida, sem lançar', async () => {
    const base = caso('integro-ao-vivo');
    const lances = base.lances.map((l, i) => (i === 0 ? { ...l, assinatura: 'curta' } : l));

    const resultado = await concluir({ ...base, lances });

    expect(resumo(resultado.problemas)).toEqual(['ASSINATURA_INVALIDA:1']);
  });

  it('dado fora da forma canônica não reproduz o hash', async () => {
    const base = caso('integro-ao-vivo');
    const lances = base.lances.map((l, i) => (i === 1 ? { ...l, criadoEm: '27/10/2026' } : l));

    const resultado = await concluir({ ...base, lances });

    expect(resultado.problemas.map((p) => p.codigo)).toContain('HASH_DIVERGENTE');
  });
});

describe('chaves', () => {
  it('keyId ausente devolve a pendência, sem acusar', async () => {
    const base = caso('integro-selado');

    const resultado = await verificarCadeia({
      loteId: LOTE,
      lances: base.lances,
      selo: base.selo,
      chaves: [],
    });

    expect(resultado).toEqual({ tipo: 'pendente', keyIdsAusentes: [KEY_ID] });
  });

  it('depois de atualizar as chaves, o keyId ausente vira CHAVE_DESCONHECIDA', async () => {
    const base = caso('integro-ao-vivo');

    const resultado = await verificarCadeia({
      loteId: LOTE,
      lances: base.lances,
      selo: null,
      chaves: [],
      chavesAtualizadas: true,
    });

    if (resultado.tipo !== 'concluida') throw new Error('verificação pendente');
    expect(resultado.veredito).toBe('adulterado');
    expect(resumo(resultado.problemas)).toEqual([
      'CHAVE_DESCONHECIDA:1',
      'CHAVE_DESCONHECIDA:2',
      'CHAVE_DESCONHECIDA:3',
    ]);
  });

  it('informa os keyIds usados', async () => {
    const resultado = await concluir(caso('integro-selado'));

    expect(resultado.keyIdsUsados).toEqual([KEY_ID]);
  });

  it('chave publicada malformada não verifica nada', async () => {
    const resultado = await concluir(caso('integro-ao-vivo'), [
      { keyId: KEY_ID, chavePublica: 'curta' },
    ]);

    expect(resultado.problemas.map((p) => p.codigo)).toEqual(Array(3).fill('CHAVE_DESCONHECIDA'));
  });
});

describe('erros de contexto', () => {
  it('sem crypto.subtle lança erro tipado, sem veredito', async () => {
    vi.stubGlobal('crypto', {});
    const base = caso('integro-ao-vivo');

    await expect(
      verificarCadeia({ loteId: LOTE, lances: base.lances, selo: null, chaves: CHAVES }),
    ).rejects.toBeInstanceOf(ErroDeContextoInseguro);
  });

  it('loteId que não é UUID em minúsculas é erro de quem chama', async () => {
    await expect(
      verificarCadeia({ loteId: 'ABC', lances: [], selo: null, chaves: CHAVES }),
    ).rejects.toBeInstanceOf(ErroDeCanonico);
  });
});
