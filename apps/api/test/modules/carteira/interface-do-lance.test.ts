// Unidade: interface pública da carteira para o lance (tarefa 074; specs/004, D12). O caminho com
// o banco fica na integração; aqui, a ordem dos locks e a validação antes de tocar a transação.
import { describe, expect, it } from 'vitest';

import type { Transacao } from '../../../src/db/banco.js';
import {
  comprometer,
  ErroDeCarteira,
  liberar,
  ordemDeTrava,
} from '../../../src/modules/carteira/index.js';

const A = '0199f0a0-0000-7000-8000-00000000000a';
const B = '0199f0a0-0000-7000-8000-00000000000b';
const C = '0199f0a0-0000-7000-8000-00000000000c';
const REFERENCIA = {
  loteId: '0199f0a0-0000-7000-8000-000000000101',
  lanceId: '0199f0a0-0000-7000-8000-000000000201',
};

/** Transação que falha em qualquer uso: prova que a validação vem antes do banco. */
const TX_INTOCAVEL = new Proxy(
  {},
  {
    get() {
      throw new Error('a transação não deveria ser usada');
    },
  },
) as Transacao;

describe('ordemDeTrava (D12)', () => {
  it('ordena os user_id em ordem crescente', () => {
    expect(ordemDeTrava([C, A, B])).toEqual([A, B, C]);
  });

  it('remove repetidos: a mesma carteira é travada uma vez', () => {
    expect(ordemDeTrava([B, A, B])).toEqual([A, B]);
  });

  it('normaliza maiúsculas para a ordem bater com a do uuid no Postgres', () => {
    expect(ordemDeTrava([B.toUpperCase(), A])).toEqual([A, B]);
  });

  it('não altera a lista recebida', () => {
    const ids = [B, A];
    ordemDeTrava(ids);
    expect(ids).toEqual([B, A]);
  });
});

describe.each([
  ['comprometer', comprometer],
  ['liberar', liberar],
] as const)('%s valida o valor antes de tocar a transação', (_nome, operacao) => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('recusa %s', async (valor) => {
    await expect(operacao(TX_INTOCAVEL, A, valor, REFERENCIA)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('ErroDeCarteira', () => {
  it('é erro de domínio, sem status HTTP', () => {
    const erro = new ErroDeCarteira('SALDO_INSUFICIENTE', { disponivel: 10, valor: 20 });

    expect(erro).toBeInstanceOf(Error);
    expect(erro.codigo).toBe('SALDO_INSUFICIENTE');
    expect(erro.name).toBe('ErroDeCarteira');
    expect('status' in erro).toBe(false);
  });
});
