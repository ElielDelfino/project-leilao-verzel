// Sem infraestrutura: falha do banco nas rotas públicas de auditoria (tarefa 111; specs/011 §Rate
// limit, último parágrafo; specs/001 §Erros). Estouro do statement_timeout (57014) e qualquer
// ErroDoBanco viram 503 INDISPONIVEL sem `detalhes`, com `Cache-Control: no-store`, e o log leva só
// o nome e o código do erro. O caso "banco fora de verdade" usa os clientes reais apontados para a
// porta 1 (ECONNREFUSED).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BancoVerificavel } from '../../../../src/db/banco.js';
import { ErroDoBanco } from '../../../../src/db/banco.js';
import { bancoFalso, contadorFalso, criarAppDeTeste } from '../../../helpers/app-de-teste.js';
import { capturarLogs, type LinhaDeLog } from '../../../helpers/captura-de-logs.js';

const LOTE = '0192f000-0000-7000-8000-00000000cafe';
const ROTAS = [`/api/auditoria/lotes/${LOTE}`, '/api/auditoria/chaves'] as const;
/** Nomes do schema que o ErroDoBanco carrega na mensagem e não devem chegar ao log nem ao cliente. */
const TABELA = 'tabela_secreta';
const RESTRICAO = 'restricao_secreta';

/** Banco cujas leituras rejeitam com um ErroDoBanco de `codigo`. */
function bancoQueFalha(codigo: string): BancoVerificavel {
  const erro = (): Promise<never> =>
    Promise.reject(
      new ErroDoBanco({ codigo, restricao: RESTRICAO, tabela: TABELA, coluna: undefined }),
    );
  return { ...bancoFalso(), consultar: erro, transaction: erro };
}

function esperar503(resposta: LightMyRequestResponse): void {
  expect(resposta.statusCode).toBe(503);
  const corpo = resposta.json<Record<string, unknown>>();
  expect(corpo).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
  expect(corpo).not.toHaveProperty('dados');
  expect(corpo['erro']).not.toHaveProperty('detalhes');
  expect(resposta.headers['cache-control']).toBe('no-store');
  expect(resposta.body).not.toContain(TABELA);
  expect(resposta.body).not.toContain(RESTRICAO);
}

describe.each([
  ['estouro do statement_timeout (57014)', '57014'],
  ['falha de conexão do banco (ECONNREFUSED)', 'ECONNREFUSED'],
  ['outro erro do banco (XX000)', 'XX000'],
])('auditoria pública com %s', (_nome, codigo) => {
  let app: NestFastifyApplication;
  let linhas: LinhaDeLog[];

  beforeAll(async () => {
    const captura = capturarLogs();
    linhas = captura.linhas;
    app = await criarAppDeTeste({
      banco: bancoQueFalha(codigo),
      contador: contadorFalso(),
      destinoDosLogs: captura.destino,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(ROTAS)('%s responde 503 INDISPONIVEL com no-store', async (url) => {
    esperar503(await app.inject({ method: 'GET', url }));
  });

  it('o log leva o nome e o código do erro, sem os nomes do schema', async () => {
    await app.inject({ method: 'GET', url: ROTAS[0] });

    const avisos = linhas.filter((l) => /auditoria: banco indispon[ií]vel/.test(String(l['msg'])));
    expect(avisos.length).toBeGreaterThan(0);
    for (const aviso of avisos) {
      expect(String(aviso['msg'])).toContain('ErroDoBanco');
      expect(String(aviso['msg'])).toContain(codigo);
    }
    const texto = JSON.stringify(linhas);
    expect(texto).not.toContain(TABELA);
    expect(texto).not.toContain(RESTRICAO);
  });
});

describe('auditoria pública com o Postgres fora de verdade (porta fechada)', () => {
  let app: NestFastifyApplication;
  let linhas: LinhaDeLog[];

  beforeAll(async () => {
    // ENV_DE_TESTE aponta Postgres e Redis para a porta 1: o rate limit falha aberto e o pool
    // recusa a conexão com um erro de sistema cru (ECONNREFUSED), que src/db não converte.
    const captura = capturarLogs();
    linhas = captura.linhas;
    app = await criarAppDeTeste({ clientesReais: true, destinoDosLogs: captura.destino });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(ROTAS)('%s responde 503 INDISPONIVEL com no-store', async (url) => {
    esperar503(await app.inject({ method: 'GET', url }));
  });

  it('o log leva só o nome e o código do erro de conexão, sem o endereço do banco', async () => {
    await app.inject({ method: 'GET', url: ROTAS[0] });

    const avisos = linhas.filter((l) => /auditoria: banco indispon[ií]vel/.test(String(l['msg'])));
    expect(avisos.length).toBeGreaterThan(0);
    expect(String(avisos[0]?.['msg'])).toContain('ECONNREFUSED');
    const texto = JSON.stringify(linhas);
    expect(texto).not.toContain('127.0.0.1');
    // O filtro global registra o 503 com o próprio ErroApi; o erro cru do pool nunca chega lá.
    const registrados = linhas.flatMap((l) => {
      const err = l['err'] as { type?: unknown } | undefined;
      return err === undefined ? [] : [err.type];
    });
    expect(registrados.every((tipo) => tipo === 'ErroApi')).toBe(true);
  });
});
