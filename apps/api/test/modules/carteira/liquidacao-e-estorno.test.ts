// Unidade: estornar, debitarArremate e creditarArremate (tarefa 103; specs/004 §Comportamento).
// O repositório é simulado: valida o valor antes do banco, recusa por comprometido insuficiente
// sem gravar e traduz a violação do índice único (lote_id, tipo) da tarefa 102 em
// LIQUIDACAO_JA_PROCESSADA, sem vazar o erro do driver.
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transacao } from '../../../src/db/banco.js';
import {
  creditarArremate,
  debitarArremate,
  ErroDeCarteira,
  estornar,
} from '../../../src/modules/carteira/index.js';

const repositorio = vi.hoisted(() => ({
  travarSaldo: vi.fn(),
  inserirLancamento: vi.fn(),
  atualizarSaldo: vi.fn(),
}));

vi.mock('../../../src/modules/carteira/repositorio.js', () => repositorio);

const USUARIO = '0199f0a0-0000-7000-8000-00000000000a';
const REFERENCIA = {
  loteId: '0199f0a0-0000-7000-8000-000000000101',
  lanceId: '0199f0a0-0000-7000-8000-000000000201',
};
const INDICE_DO_LOTE = 'ledger_entries_lote_id_tipo_unico';
const TX = {} as Transacao;

function erroDoDriver(codigo: string, restricao: string): DatabaseError {
  const erro = new DatabaseError(
    `duplicate key value violates unique constraint "${restricao}"`,
    0,
    'error',
  );
  erro.code = codigo;
  erro.constraint = restricao;
  erro.table = 'ledger_entries';
  erro.detail = `Key (lote_id, tipo)=(${REFERENCIA.loteId}, estorno) already exists.`;
  return erro;
}

function falhaDoInsert(codigo: string, restricao: string): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "ledger_entries" (...) values ($1, $2, $3, $4, $5)',
    [USUARIO, 'estorno', 500, REFERENCIA.loteId, REFERENCIA.lanceId],
    erroDoDriver(codigo, restricao),
  );
}

const OPERACOES = [
  ['estornar', estornar, 'estorno', { total: 0, comprometido: -500 }],
  ['debitarArremate', debitarArremate, 'debito_arremate', { total: -500, comprometido: -500 }],
  ['creditarArremate', creditarArremate, 'credito_arremate', { total: 500, comprometido: 0 }],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  repositorio.travarSaldo.mockResolvedValue({ total: 1_000, comprometido: 500 });
  repositorio.inserirLancamento.mockResolvedValue({});
  repositorio.atualizarSaldo.mockResolvedValue({ total: 1_000, comprometido: 0 });
});

describe.each(OPERACOES)('%s', (_nome, operacao, tipo, efeito) => {
  it('grava o tipo com lote e lance, aplica o efeito e devolve o saldo com disponível', async () => {
    const saldo = await operacao(TX, USUARIO, 500, REFERENCIA);

    expect(repositorio.inserirLancamento).toHaveBeenCalledWith(TX, {
      userId: USUARIO,
      tipo,
      valorCentavos: 500,
      loteId: REFERENCIA.loteId,
      lanceId: REFERENCIA.lanceId,
    });
    expect(repositorio.atualizarSaldo).toHaveBeenCalledWith(TX, USUARIO, efeito);
    expect(saldo).toEqual({
      totalCentavos: 1_000,
      comprometidoCentavos: 0,
      disponivelCentavos: 1_000,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'valor %s → RangeError antes de tocar o banco',
    async (valor) => {
      await expect(operacao(TX, USUARIO, valor, REFERENCIA)).rejects.toBeInstanceOf(RangeError);
      expect(repositorio.travarSaldo).not.toHaveBeenCalled();
      expect(repositorio.inserirLancamento).not.toHaveBeenCalled();
    },
  );

  it('23505 no índice (lote_id, tipo) → LIQUIDACAO_JA_PROCESSADA sem valor nem driver', async () => {
    repositorio.inserirLancamento.mockRejectedValue(falhaDoInsert('23505', INDICE_DO_LOTE));

    const erro: unknown = await operacao(TX, USUARIO, 500, REFERENCIA).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeCarteira);
    expect(erro).toMatchObject({ codigo: 'LIQUIDACAO_JA_PROCESSADA', valor: undefined });
    expect((erro as Error).cause).toBeUndefined();
    expect((erro as Error).message).not.toMatch(/23505|duplicate|ledger_entries|Key \(/);
    expect(repositorio.atualizarSaldo).not.toHaveBeenCalled();
  });

  it('também com o DatabaseError do pg sem o embrulho do Drizzle', async () => {
    repositorio.inserirLancamento.mockRejectedValue(erroDoDriver('23505', INDICE_DO_LOTE));

    await expect(operacao(TX, USUARIO, 500, REFERENCIA)).rejects.toMatchObject({
      codigo: 'LIQUIDACAO_JA_PROCESSADA',
    });
  });

  it('23505 em outra restrição segue como veio', async () => {
    const falha = falhaDoInsert('23505', 'outra_restricao');
    repositorio.inserirLancamento.mockRejectedValue(falha);

    await expect(operacao(TX, USUARIO, 500, REFERENCIA)).rejects.toBe(falha);
  });

  it('outro código no mesmo índice segue como veio', async () => {
    const falha = falhaDoInsert('23503', INDICE_DO_LOTE);
    repositorio.inserirLancamento.mockRejectedValue(falha);

    await expect(operacao(TX, USUARIO, 500, REFERENCIA)).rejects.toBe(falha);
  });
});

describe.each([
  ['estornar', estornar],
  ['debitarArremate', debitarArremate],
] as const)('%s com comprometido menor que o valor', (_nome, operacao) => {
  it('recusa com COMPROMETIDO_INSUFICIENTE sem gravar lançamento', async () => {
    const tentativa = operacao(TX, USUARIO, 501, REFERENCIA);

    await expect(tentativa).rejects.toBeInstanceOf(ErroDeCarteira);
    await expect(tentativa).rejects.toMatchObject({
      codigo: 'COMPROMETIDO_INSUFICIENTE',
      valor: 501,
      comprometido: 500,
    });
    expect(repositorio.inserirLancamento).not.toHaveBeenCalled();
    expect(repositorio.atualizarSaldo).not.toHaveBeenCalled();
  });

  it('valor igual ao comprometido é aceito (limite exato)', async () => {
    await operacao(TX, USUARIO, 500, REFERENCIA);

    expect(repositorio.inserirLancamento).toHaveBeenCalledTimes(1);
  });
});

describe('creditarArremate', () => {
  it('não depende do comprometido: credita mesmo com a carteira zerada', async () => {
    repositorio.travarSaldo.mockResolvedValue({ total: 0, comprometido: 0 });

    await creditarArremate(TX, USUARIO, 500, REFERENCIA);

    expect(repositorio.inserirLancamento).toHaveBeenCalledTimes(1);
  });
});
