// /api/health/ready contra Postgres e Redis reais (tarefa 017, specs/014 §Critérios de aceite).
// "Fora" é uma porta do loopback sem ninguém escutando: o cliente real recebe ECONNREFUSED.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { Env } from '../../src/config/env.js';
import { trocarBanco } from '../../src/db/conexao.js';
import { criarConexaoDoRedis } from '../../src/redis/conexao.js';
import { ambienteDeTeste } from '../db/ambiente-de-teste.js';
import { criarAppDeTeste, ENV_DE_TESTE } from '../helpers/app-de-teste.js';
import { capturarLogs, type LinhaDeLog } from '../helpers/captura-de-logs.js';
import { portaFechada } from '../helpers/porta-fechada.js';
import { ambienteDoRedis } from '../redis/ambiente-de-teste.js';

const banco = ambienteDeTeste(process.env);
const redis = ambienteDoRedis(process.env);

describe.skipIf(!banco.disponivel || !redis.disponivel)(
  'GET /api/health/ready com Postgres e Redis reais',
  () => {
    let app: NestFastifyApplication | undefined;

    afterEach(async () => {
      await app?.close();
      app = undefined;
    });

    function envReal(): Env {
      return { ...ENV_DE_TESTE, postgres: banco.conexao(), redis: redis.conexao() };
    }

    async function pronta(env: Env): Promise<{
      status: number;
      corpo: string;
      linhas: LinhaDeLog[];
    }> {
      const { destino, linhas } = capturarLogs();
      app = await criarAppDeTeste({ env, clientesReais: true, destinoDosLogs: destino });
      const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });
      return { status: resposta.statusCode, corpo: resposta.body, linhas };
    }

    /** Nada de host, porta ou senha de nenhuma das conexões na resposta nem no log. */
    function semDetalhesDeConexao(env: Env, ...textos: string[]): void {
      for (const texto of textos) {
        expect(texto).not.toContain(env.postgres.password);
        expect(texto).not.toContain(env.redis.password);
        expect(texto).not.toContain(env.postgres.host);
        expect(texto).not.toContain(env.redis.host);
        expect(texto).not.toContain(`:${env.postgres.port}`);
        expect(texto).not.toContain(`:${env.redis.port}`);
      }
    }

    it('200 { sucesso: true, dados: { status: "ok" } } com os dois de pé', async () => {
      const env = envReal();

      const { status, corpo, linhas } = await pronta(env);

      expect(status).toBe(200);
      expect(JSON.parse(corpo)).toEqual({ sucesso: true, dados: { status: 'ok' } });
      semDetalhesDeConexao(env, JSON.stringify(linhas));
    });

    it('503 INDISPONIVEL sem detalhes com o Redis fora', async () => {
      const real = envReal();
      const env: Env = {
        ...real,
        redis: criarConexaoDoRedis(
          { host: real.redis.host, port: await portaFechada() },
          real.redis.password,
        ),
      };

      const { status, corpo, linhas } = await pronta(env);

      expect(status).toBe(503);
      expect(JSON.parse(corpo)).toEqual({
        sucesso: false,
        erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) },
      });
      expect(corpo).not.toMatch(/redis|postgres/i);
      const aviso = linhas.find((linha) => String(linha.msg).includes('prontidão falhou'));
      expect(aviso?.msg).toContain('redis');
      expect(aviso?.level).toBe(40);
      semDetalhesDeConexao(env, corpo, JSON.stringify(linhas));
    });

    it('503 INDISPONIVEL sem detalhes com o Postgres fora', async () => {
      const real = envReal();
      const fora = await portaFechada();
      const env: Env = {
        ...real,
        postgres: trocarBanco(
          { ...real.postgres, port: fora, password: real.postgres.password },
          real.postgres.database,
        ),
      };

      const { status, corpo, linhas } = await pronta(env);

      expect(status).toBe(503);
      expect(JSON.parse(corpo)).toEqual({
        sucesso: false,
        erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) },
      });
      expect(corpo).not.toMatch(/redis|postgres/i);
      const aviso = linhas.find((linha) => String(linha.msg).includes('prontidão falhou'));
      expect(aviso?.msg).toContain('postgres');
      expect(aviso?.msg).toContain('ECONNREFUSED');
      semDetalhesDeConexao(env, corpo, JSON.stringify(linhas));
    });
  },
);
