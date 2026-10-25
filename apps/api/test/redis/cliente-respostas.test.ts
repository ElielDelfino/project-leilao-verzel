// Unidade: respostas inesperadas do EXEC no rate limit viram ErroDoRedis (falha fechada). Sem a
// conferência, `contagem` viraria NaN e `NaN > 5` deixaria passar a 6ª tentativa (tarefa 047).
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFalso = vi.fn<() => Promise<unknown>>();

vi.mock('redis', () => {
  const multi = {
    incr: () => multi,
    expire: () => multi,
    ttl: () => multi,
    exec: () => execFalso(),
  };
  return {
    createClient: () => ({
      on: () => undefined,
      connect: () => Promise.resolve(),
      destroy: () => undefined,
      isReady: true,
      multi: () => multi,
    }),
  };
});

const { criarClienteRedis, ErroDoRedis } = await import('../../src/redis/cliente.js');
const { criarConexaoDoRedis } = await import('../../src/redis/conexao.js');

function cliente() {
  return criarClienteRedis({
    conexao: criarConexaoDoRedis({ host: '127.0.0.1', port: 1 }, 'x'.repeat(43)),
    aoErro: () => undefined,
  });
}

describe('incrementarNaJanela com resposta inesperada do EXEC', () => {
  afterEach(() => {
    execFalso.mockReset();
  });

  it.each([
    ['contagem não numérica', ['x', 1, 60]],
    ['TTL não numérico', [1, 1, 'x']],
    ['contagem fracionária', [1.5, 1, 60]],
    ['null', null],
    ['não array', { contagem: 1 }],
  ])('%s → ErroDoRedis RespostaInesperada', async (_caso, resposta) => {
    execFalso.mockResolvedValue(resposta);

    await expect(cliente().incrementarNaJanela('ratelimit:x', 60)).rejects.toMatchObject({
      name: 'ErroDoRedis',
      tipo: 'RespostaInesperada',
    });
    await expect(cliente().incrementarNaJanela('ratelimit:x', 60)).rejects.toBeInstanceOf(
      ErroDoRedis,
    );
  });

  it('resposta válida devolve contagem e TTL', async () => {
    execFalso.mockResolvedValue([3, 0, 42]);

    await expect(cliente().incrementarNaJanela('ratelimit:x', 60)).resolves.toEqual({
      contagem: 3,
      ttlS: 42,
    });
  });
});
