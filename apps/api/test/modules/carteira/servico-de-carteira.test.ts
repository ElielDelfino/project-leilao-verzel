// Unidade: corrida da Idempotency-Key resolvida pela unique (specs/004 §Comportamento; tarefa
// 039). A corrida real fica serializada pela trava da linha (teste de integração); aqui o 23505
// é forçado por um banco falso para cobrir a última defesa.
import { describe, expect, it, vi } from 'vitest';

import { type BancoVerificavel, ErroDoBanco } from '../../../src/db/banco.js';
import {
  type ResultadoDoDeposito,
  ServicoDeCarteira,
} from '../../../src/modules/carteira/servico-de-carteira.js';
import { bancoFalso } from '../../helpers/app-de-teste.js';

const REPETICAO: ResultadoDoDeposito = {
  criado: false,
  lancamento: {
    id: '0199f0a0-0000-7000-8000-000000000001',
    tipo: 'deposito',
    valorCentavos: 1000,
    loteId: null,
    criadoEm: '2026-10-25T12:00:00.000Z',
  },
  saldo: { totalCentavos: 1000, comprometidoCentavos: 0, disponivelCentavos: 1000 },
};

function erroDoBanco(codigo: string, restricao: string): ErroDoBanco {
  return new ErroDoBanco({ codigo, restricao, tabela: 'ledger_entries', coluna: undefined });
}

function servicoCom(transaction: () => Promise<unknown>): ServicoDeCarteira {
  return new ServicoDeCarteira({
    ...bancoFalso(),
    transaction: transaction as BancoVerificavel['transaction'],
  });
}

describe('ServicoDeCarteira.depositar', () => {
  it('23505 na unique da chave → repete a transação uma vez e devolve a repetição', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(erroDoBanco('23505', 'ledger_entries_user_id_idempotency_key_unique'))
      .mockResolvedValueOnce(REPETICAO);

    const resultado = await servicoCom(transaction).depositar('u', 'k', 1000);

    expect(resultado).toBe(REPETICAO);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('23505 em outra restrição é repassado sem nova tentativa', async () => {
    const erro = erroDoBanco('23505', 'outra_restricao');
    const transaction = vi.fn().mockRejectedValue(erro);

    await expect(servicoCom(transaction).depositar('u', 'k', 1000)).rejects.toBe(erro);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('erro que não é do banco é repassado sem nova tentativa', async () => {
    const erro = new Error('falha');
    const transaction = vi.fn().mockRejectedValue(erro);

    await expect(servicoCom(transaction).depositar('u', 'k', 1000)).rejects.toBe(erro);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
