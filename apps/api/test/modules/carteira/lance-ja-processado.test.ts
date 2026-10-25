// Unidade: tradução da violação do índice único (lance_id, tipo) de ledger_entries (tarefa 092)
// em ErroDeCarteira LANCE_JA_PROCESSADO (tarefa 093; specs/004). O repositório é simulado para
// provar que só esse índice é traduzido: outra 23505, ou outro código, segue como veio.
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transacao } from '../../../src/db/banco.js';
import { comprometer, ErroDeCarteira, liberar } from '../../../src/modules/carteira/index.js';

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
const INDICE_DO_LANCE = 'ledger_entries_lance_id_tipo_unico';
const CONSULTA = 'insert into "ledger_entries" (...) values ($1, $2, $3, $4, $5)';
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
  erro.detail = `Key (lance_id, tipo)=(${REFERENCIA.lanceId}, compromisso) already exists.`;
  return erro;
}

/** Como o Drizzle 0.45 entrega a falha de um INSERT: DrizzleQueryError com o pg em `cause`. */
function falhaDoInsert(codigo: string, restricao: string): DrizzleQueryError {
  return new DrizzleQueryError(
    CONSULTA,
    [USUARIO, 'compromisso', 500, REFERENCIA.loteId, REFERENCIA.lanceId],
    erroDoDriver(codigo, restricao),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  repositorio.travarSaldo.mockResolvedValue({ total: 1_000, comprometido: 500 });
});

describe.each([
  ['comprometer', comprometer],
  ['liberar', liberar],
] as const)('%s com o lançamento do lance já gravado', (_nome, operacao) => {
  it('23505 no índice (lance_id, tipo) → ErroDeCarteira LANCE_JA_PROCESSADO', async () => {
    repositorio.inserirLancamento.mockRejectedValue(falhaDoInsert('23505', INDICE_DO_LANCE));

    const tentativa = operacao(TX, USUARIO, 500, REFERENCIA);

    await expect(tentativa).rejects.toBeInstanceOf(ErroDeCarteira);
    await expect(tentativa).rejects.toMatchObject({ codigo: 'LANCE_JA_PROCESSADO' });
    expect(repositorio.atualizarSaldo).not.toHaveBeenCalled();
  });

  it('também com o DatabaseError do pg sem o embrulho do Drizzle', async () => {
    repositorio.inserirLancamento.mockRejectedValue(erroDoDriver('23505', INDICE_DO_LANCE));

    await expect(operacao(TX, USUARIO, 500, REFERENCIA)).rejects.toMatchObject({
      codigo: 'LANCE_JA_PROCESSADO',
    });
  });

  it('o erro não leva o erro do driver, a linha, o SQL nem valores', async () => {
    repositorio.inserirLancamento.mockRejectedValue(falhaDoInsert('23505', INDICE_DO_LANCE));

    const erro: unknown = await operacao(TX, USUARIO, 500, REFERENCIA).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeCarteira);
    const recusa = erro as ErroDeCarteira;
    expect(recusa.cause).toBeUndefined();
    expect(recusa.valor).toBeUndefined();
    expect(recusa.disponivel).toBeUndefined();
    expect(recusa.comprometido).toBeUndefined();
    const visivel = `${recusa.message} ${recusa.stack ?? ''} ${JSON.stringify(recusa)}`;
    for (const vazamento of [REFERENCIA.lanceId, USUARIO, '500', 'insert', 'Key (']) {
      expect(visivel).not.toContain(vazamento);
    }
  });

  it('23505 em outra restrição segue como veio, sem tradução', async () => {
    const outra = falhaDoInsert('23505', 'ledger_entries_user_id_idempotency_key_unique');
    repositorio.inserirLancamento.mockRejectedValue(outra);

    await expect(operacao(TX, USUARIO, 500, REFERENCIA)).rejects.toBe(outra);
  });

  it('outro código no mesmo índice segue como veio, sem tradução', async () => {
    const outra = falhaDoInsert('23503', INDICE_DO_LANCE);
    repositorio.inserirLancamento.mockRejectedValue(outra);

    await expect(operacao(TX, USUARIO, 500, REFERENCIA)).rejects.toBe(outra);
  });

  it('erro que não é do banco segue como veio', async () => {
    const outra = new Error('conexão perdida');
    repositorio.inserirLancamento.mockRejectedValue(outra);

    await expect(operacao(TX, USUARIO, 500, REFERENCIA)).rejects.toBe(outra);
  });
});
