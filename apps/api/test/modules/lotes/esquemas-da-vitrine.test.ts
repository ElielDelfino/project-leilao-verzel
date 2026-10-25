// Unidades da validação dos parâmetros da vitrine (specs/006 §Vitrine): padrões, fronteiras de
// cada parâmetro, o campo citado em `detalhes.campo` e o escape do LIKE (sem rede nem banco).
import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import {
  escaparLike,
  PipeDaVitrine,
  validarFiltrosDaVitrine,
} from '../../../src/modules/lotes/esquemas-da-vitrine.js';

const PRECO_MAXIMO = 10_000_000_000;

function campoInvalido(consulta: Record<string, unknown>): string | undefined {
  const resultado = validarFiltrosDaVitrine(consulta);
  return resultado.ok ? undefined : resultado.campo;
}

describe('validarFiltrosDaVitrine', () => {
  it('sem parâmetros: todos os status, termina_antes e página 1', () => {
    expect(validarFiltrosDaVitrine({})).toEqual({
      ok: true,
      filtros: {
        status: null,
        q: null,
        precoMin: null,
        precoMax: null,
        raridade: null,
        ordem: 'termina_antes',
        pagina: 1,
      },
    });
  });

  it('aceita todos os parâmetros válidos e apara o q', () => {
    const resultado = validarFiltrosDaVitrine({
      status: 'ao_vivo',
      q: '  Bolt ',
      precoMin: '0',
      precoMax: String(PRECO_MAXIMO),
      raridade: 'mythic',
      ordem: 'maior_lance',
      pagina: '500',
    });
    expect(resultado).toEqual({
      ok: true,
      filtros: {
        status: 'ao_vivo',
        q: 'Bolt',
        precoMin: 0,
        precoMax: PRECO_MAXIMO,
        raridade: 'mythic',
        ordem: 'maior_lance',
        pagina: 500,
      },
    });
  });

  it('precoMin igual a precoMax é válido (faixa fechada)', () => {
    expect(campoInvalido({ precoMin: '700', precoMax: '700' })).toBeUndefined();
  });

  it.each([
    [{ status: 'cancelado' }, 'status'],
    [{ status: 'AO_VIVO' }, 'status'],
    [{ q: '' }, 'q'],
    [{ q: '   ' }, 'q'],
    [{ q: 'a'.repeat(101) }, 'q'],
    [{ precoMin: '-1' }, 'precoMin'],
    [{ precoMin: '1.5' }, 'precoMin'],
    [{ precoMin: '01' }, 'precoMin'],
    [{ precoMin: String(PRECO_MAXIMO + 1) }, 'precoMin'],
    [{ precoMax: 'dez' }, 'precoMax'],
    [{ precoMin: '200', precoMax: '199' }, 'precoMax'],
    [{ raridade: 'lendaria' }, 'raridade'],
    [{ ordem: 'mais_barato' }, 'ordem'],
    [{ pagina: '0' }, 'pagina'],
    [{ pagina: '501' }, 'pagina'],
    [{ status: ['ao_vivo', 'agendado'] }, 'status'],
    [{ desconhecido: '1' }, 'desconhecido'],
    [{ 'a b': '1' }, 'consulta'],
  ])('%j → 422 com campo %s', (consulta, campo) => {
    expect(campoInvalido(consulta)).toBe(campo);
  });

  it('q com 100 caracteres (code points) é válido', () => {
    expect(campoInvalido({ q: '🃏'.repeat(100) })).toBeUndefined();
  });

  it('cita o primeiro inválido na ordem do contrato', () => {
    expect(campoInvalido({ pagina: '0', q: '', status: 'x' })).toBe('status');
  });
});

describe('escaparLike', () => {
  it('trata %, _ e \\ como texto literal', () => {
    expect(escaparLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});

describe('PipeDaVitrine', () => {
  it('lança 422 DADOS_INVALIDOS com detalhes.campo', () => {
    const erro = (() => {
      try {
        new PipeDaVitrine().transform({ ordem: 'x' });
        return undefined;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(erro).toBeInstanceOf(ErroApi);
    expect((erro as ErroApi).status).toBe(422);
    expect((erro as ErroApi).codigo).toBe('DADOS_INVALIDOS');
    expect((erro as ErroApi).detalhes).toEqual({ campo: 'ordem' });
  });
});
