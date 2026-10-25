import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { criarConexaoDoRedis } from '../../src/redis/conexao.js';
import { type ClienteRedis, criarClienteRedis, ErroDoRedis } from '../../src/redis/cliente.js';
import { portaFechada } from '../helpers/porta-fechada.js';
import { ambienteDoRedis } from './ambiente-de-teste.js';

const SENHA = randomBytes(32).toString('base64url');

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

describe('criarClienteRedis com o Redis fora (porta fechada)', () => {
  let cliente: ClienteRedis | undefined;
  const erros: unknown[] = [];

  afterEach(async () => {
    await cliente?.encerrar();
    cliente = undefined;
    erros.length = 0;
  });

  async function clienteSemRedis(): Promise<{ cliente: ClienteRedis; porta: number }> {
    const porta = await portaFechada();
    cliente = criarClienteRedis({
      conexao: criarConexaoDoRedis({ host: '127.0.0.1', port: porta }, SENHA),
      aoErro: (erro) => erros.push(erro),
    });
    return { cliente, porta };
  }

  it('o ping é cancelado pelo AbortSignal, sem ficar pendurado na fila', async () => {
    const { cliente: redis } = await clienteSemRedis();
    const controlador = new AbortController();
    setTimeout(() => controlador.abort(new Error('tempo esgotado')), 100);
    const inicio = performance.now();

    await expect(redis.ping(controlador.signal)).rejects.toBeInstanceOf(ErroDoRedis);

    expect(performance.now() - inicio).toBeLessThan(1_000);
  });

  it('com o sinal já abortado, o ping falha na hora', async () => {
    const { cliente: redis } = await clienteSemRedis();

    await expect(redis.ping(AbortSignal.abort())).rejects.toMatchObject({
      name: 'ErroDoRedis',
      tipo: 'AbortError',
    });
  });

  it('avisa a falha de conexão uma vez, só com o código, sem host, porta nem senha', async () => {
    const { porta } = await clienteSemRedis();

    // O cliente tenta reconectar várias vezes nesse intervalo (backoff a partir de 50 ms).
    await esperar(800);

    expect(erros).toHaveLength(1);
    const [erro] = erros;
    expect(erro).toBeInstanceOf(ErroDoRedis);
    expect(erro).toMatchObject({ codigo: 'ECONNREFUSED' });
    const texto = `${String((erro as Error).message)} ${String((erro as Error).stack)}`;
    expect(texto).not.toContain('127.0.0.1');
    expect(texto).not.toContain(String(porta));
    expect(texto).not.toContain(SENHA);
    expect(erro).not.toHaveProperty('cause');
  });

  it('encerrar é idempotente e o ping depois dele falha convertido', async () => {
    const { cliente: redis } = await clienteSemRedis();

    await redis.encerrar();
    await redis.encerrar();

    await expect(redis.ping(new AbortController().signal)).rejects.toBeInstanceOf(ErroDoRedis);
    // O loop de reconexão termina: nenhum aviso novo depois do encerramento.
    const avisos = erros.length;
    await esperar(300);
    expect(erros).toHaveLength(avisos);
  });
});

const ambiente = ambienteDoRedis(process.env);

describe.skipIf(!ambiente.disponivel)('criarClienteRedis contra o Redis real', () => {
  let cliente: ClienteRedis | undefined;
  const erros: unknown[] = [];

  afterEach(async () => {
    await cliente?.encerrar();
    cliente = undefined;
    erros.length = 0;
  });

  it('PING responde com a senha certa', async () => {
    cliente = criarClienteRedis({
      conexao: ambiente.conexao(),
      aoErro: (erro) => erros.push(erro),
    });

    await expect(cliente.ping(AbortSignal.timeout(2_000))).resolves.toBeUndefined();
    expect(erros).toEqual([]);
  });

  it('com a senha errada, o ping falha e nada cita a senha', async () => {
    const real = ambiente.conexao();
    cliente = criarClienteRedis({
      conexao: criarConexaoDoRedis({ host: real.host, port: real.port }, SENHA),
      aoErro: (erro) => erros.push(erro),
    });

    await expect(cliente.ping(AbortSignal.timeout(500))).rejects.toBeInstanceOf(ErroDoRedis);
    expect(erros.length).toBeGreaterThan(0);
    for (const erro of erros) {
      expect(erro).toBeInstanceOf(ErroDoRedis);
      expect(JSON.stringify(erro)).not.toContain(SENHA);
      expect((erro as Error).message).not.toContain(SENHA);
    }
  });
});
