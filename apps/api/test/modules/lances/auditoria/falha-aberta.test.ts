// Sem infraestrutura: o rate limit da auditoria pública com o contador fora (Redis caído) é falha
// ABERTA (specs/011 §Rate limit, regras comuns): a requisição passa sem contar e a API registra no
// máximo um aviso por minuto por instância, só com o nome do contador (sem IP e sem o erro).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BancoVerificavel } from '../../../../src/db/banco.js';
import { bancoFalso, contadorFalso, criarAppDeTeste } from '../../../helpers/app-de-teste.js';
import { capturarLogs, type LinhaDeLog } from '../../../helpers/captura-de-logs.js';

const IP = '203.0.113.77';
const INICIO_MS = 1_800_000_000_000;
const AVISO = /rate limit da auditoria indispon[ií]vel/;

/** Banco que responde a qualquer consulta com lista vazia (nenhuma chave publicada ainda). */
function bancoSemChaves(): BancoVerificavel {
  return {
    ...bancoFalso(),
    consultar: <T>() => Promise.resolve([] as unknown as T),
  };
}

describe('auditoria pública com o contador do rate limit fora (falha aberta)', () => {
  let app: NestFastifyApplication;
  let linhas: LinhaDeLog[];

  beforeAll(async () => {
    const captura = capturarLogs();
    linhas = captura.linhas;
    app = await criarAppDeTeste({
      banco: bancoSemChaves(),
      contador: contadorFalso(),
      destinoDosLogs: captura.destino,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const avisos = (): LinhaDeLog[] => linhas.filter((l) => AVISO.test(String(l['msg'] ?? '')));

  const chaves = () =>
    app.inject({ method: 'GET', url: '/api/auditoria/chaves', remoteAddress: IP });

  it('responde 200 e avisa no máximo uma vez por minuto, sem IP nem erro', async () => {
    const agora = vi.spyOn(Date, 'now').mockReturnValue(INICIO_MS);

    for (let i = 0; i < 3; i += 1) {
      const resposta = await chaves();
      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('public, max-age=60');
    }
    expect(avisos()).toHaveLength(1);

    agora.mockReturnValue(INICIO_MS + 59_999);
    expect((await chaves()).statusCode).toBe(200);
    expect(avisos()).toHaveLength(1);

    agora.mockReturnValue(INICIO_MS + 60_000);
    expect((await chaves()).statusCode).toBe(200);
    expect(avisos()).toHaveLength(2);

    for (const aviso of avisos()) {
      expect(aviso['level']).toBe(40);
      expect(String(aviso['msg'])).toContain('auditoria:global');
      const texto = JSON.stringify(aviso);
      expect(texto).not.toContain(IP);
      expect(aviso).not.toHaveProperty('err');
      expect(texto).not.toContain('cliente falso');
    }
  });
});
