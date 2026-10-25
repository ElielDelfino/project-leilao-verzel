// Matriz papel (anônimo, licitante, leiloeiro) × operação, com e sem CSRF, para TODAS as operações
// do openapi.yaml (tarefas 043 e 062; specs/003 §CSRF e papéis, specs/004 RF-03, specs/006).
// Cada resposta também é validada contra o contrato pelo criarAppDeTeste (specs/013 §Contratos).
// `exigeCsrf` é derivado do método (helpers/contrato.ts), nunca preenchido à mão. A Scryfall é a
// falsa local: a busca e a criação de lote nunca saem da máquina.
import { randomBytes, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apagarChavesDoPrefixo, clienteDeTeste } from '../common/limite/redis-de-teste.js';
import {
  apagarChavesDaScryfall,
  criarAppDeTeste,
  novoPrefixoDaScryfall,
} from '../helpers/app-de-teste.js';
import { exigeCsrf, operacoesDoContrato } from '../helpers/contrato.js';
import { ID_CARTA_SIMPLES } from '../helpers/fixtures-scryfall/cartas.js';
import {
  apagarLotesEUsuarios,
  inserirLote,
  inserirUsuario,
  iso,
} from '../helpers/lotes-por-sql.js';
import { iniciarScryfallFalsa, type ScryfallFalsa } from '../helpers/scryfall-falsa.js';
import {
  BANCO,
  cadastrar,
  emailNovo,
  envReal,
  INFRA_DISPONIVEL,
  Navegador,
  REDIS,
  SENHA,
} from '../modules/identidade/ambiente.js';

const HORA_MS = 60 * 60 * 1000;
const TITULO_CRIADO = `matriz-${randomBytes(6).toString('hex')}`;
/** Preenchido no beforeAll: um lote e seu snapshot, para as rotas com parâmetro de caminho. */
const alvo = { loteId: '', snapshotId: '' };

type Papel = 'anonimo' | 'licitante' | 'leiloeiro';
const PAPEIS: readonly Papel[] = ['anonimo', 'licitante', 'leiloeiro'];

interface Esperado {
  readonly status: number;
  readonly codigo?: string;
}

interface Operacao {
  readonly metodo: 'GET' | 'POST';
  /** Caminho exatamente como no `paths` do contrato (ex.: `/api/lotes/{id}`). */
  readonly caminho: string;
  /** URL real, quando o caminho tem parâmetros ou a operação exige query. */
  readonly url?: () => string;
  /** Corpo (e headers extras) válidos para a operação; recebe o e-mail de uma conta existente. */
  readonly corpo?: (email: string) => object;
  readonly extras?: () => Record<string, string>;
  /** Resultado com CSRF válido, por papel. */
  readonly comCsrf: Readonly<Record<Papel, Esperado>>;
  /**
   * Rota ainda inexistente na API: os casos viram `it.todo`, sem expectativa que passe por acaso
   * (404 não vale como "ok"). Remover a marca quando a tarefa indicada entregar a rota.
   */
  readonly pendente?: { readonly tarefa: string; readonly motivo: string };
}

const igualParaTodos = (e: Esperado): Operacao['comCsrf'] => ({
  anonimo: e,
  licitante: e,
  leiloeiro: e,
});

const negadoParaLicitante: Operacao['comCsrf'] = {
  anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
  licitante: { status: 403, codigo: 'PAPEL_NAO_PERMITIDO' },
  leiloeiro: { status: 200 },
};

const OPERACOES: readonly Operacao[] = [
  { metodo: 'GET', caminho: '/api/health/live', comCsrf: igualParaTodos({ status: 200 }) },
  { metodo: 'GET', caminho: '/api/health/ready', comCsrf: igualParaTodos({ status: 200 }) },
  {
    metodo: 'GET',
    caminho: '/api/catalogo/cartas',
    url: () => '/api/catalogo/cartas?q=lightning',
    comCsrf: negadoParaLicitante,
  },
  {
    metodo: 'GET',
    caminho: '/api/imagens/{snapshotId}',
    url: () => `/api/imagens/${alvo.snapshotId}`,
    comCsrf: igualParaTodos({ status: 200 }),
  },
  { metodo: 'GET', caminho: '/api/lotes', comCsrf: igualParaTodos({ status: 200 }) },
  {
    metodo: 'GET',
    caminho: '/api/lotes/{id}',
    url: () => `/api/lotes/${alvo.loteId}`,
    comCsrf: igualParaTodos({ status: 200 }),
  },
  {
    metodo: 'POST',
    caminho: '/api/painel/lotes',
    corpo: () => ({
      scryfallId: ID_CARTA_SIMPLES,
      titulo: TITULO_CRIADO,
      lanceInicialCentavos: 100,
      incrementoMinimoCentavos: 100,
      inicioEm: iso(Date.now() + HORA_MS),
      fimEm: iso(Date.now() + 2 * HORA_MS),
    }),
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 403, codigo: 'PAPEL_NAO_PERMITIDO' },
      leiloeiro: { status: 201 },
    },
  },
  { metodo: 'GET', caminho: '/api/painel/lotes', comCsrf: negadoParaLicitante },
  { metodo: 'GET', caminho: '/api/painel/resumo', comCsrf: negadoParaLicitante },
  {
    metodo: 'GET',
    caminho: '/api/auth/csrf',
    comCsrf: igualParaTodos({ status: 204 }),
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/cadastro',
    corpo: () => ({ nome: 'Conta de Teste', email: emailNovo(), senha: SENHA, papel: 'licitante' }),
    comCsrf: igualParaTodos({ status: 201 }),
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/login',
    corpo: (email) => ({ email, senha: SENHA }),
    comCsrf: igualParaTodos({ status: 200 }),
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/refresh',
    comCsrf: {
      anonimo: { status: 401, codigo: 'SESSAO_EXPIRADA' },
      licitante: { status: 204 },
      leiloeiro: { status: 204 },
    },
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/logout',
    comCsrf: igualParaTodos({ status: 204 }),
  },
  {
    metodo: 'GET',
    caminho: '/api/auth/me',
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 200 },
      leiloeiro: { status: 200 },
    },
  },
  {
    metodo: 'GET',
    caminho: '/api/carteira',
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 200 },
      leiloeiro: { status: 200 },
    },
  },
  {
    metodo: 'GET',
    caminho: '/api/carteira/extrato',
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 200 },
      leiloeiro: { status: 200 },
    },
  },
  {
    metodo: 'POST',
    caminho: '/api/carteira/depositos',
    corpo: () => ({ valorCentavos: 1000 }),
    extras: () => ({ 'idempotency-key': randomUUID() }),
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 201 },
      leiloeiro: { status: 403, codigo: 'PAPEL_NAO_PERMITIDO' },
    },
  },
  // F3 (openapi 0.5.0): rotas pendentes até as tarefas 079 (POST lances), 080 (leituras de lances) e 081 (auditoria).
  {
    metodo: 'POST',
    caminho: '/api/lotes/{id}/lances',
    url: () => `/api/lotes/${alvo.loteId}/lances`,
    corpo: () => ({ valorCentavos: 100_000 }),
    extras: () => ({ 'idempotency-key': randomUUID() }),
    // O lote do alvo precisa estar ativo para o 201 do licitante: a 079 ajusta o cenário.
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 201 },
      leiloeiro: { status: 403, codigo: 'LEILOEIRO_NAO_PODE_LANCAR' },
    },
    pendente: { tarefa: '079', motivo: 'POST /api/lotes/{id}/lances ainda não existe na API' },
  },
  {
    metodo: 'GET',
    caminho: '/api/lotes/{id}/lances',
    url: () => `/api/lotes/${alvo.loteId}/lances`,
    comCsrf: igualParaTodos({ status: 200 }),
    pendente: { tarefa: '080', motivo: 'GET /api/lotes/{id}/lances ainda não existe na API' },
  },
  {
    metodo: 'GET',
    caminho: '/api/me/lances',
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 200 },
      leiloeiro: { status: 403, codigo: 'PAPEL_NAO_PERMITIDO' },
    },
    pendente: { tarefa: '080', motivo: 'GET /api/me/lances ainda não existe na API' },
  },
  {
    metodo: 'GET',
    caminho: '/api/auditoria/lotes/{id}',
    url: () => `/api/auditoria/lotes/${alvo.loteId}`,
    comCsrf: igualParaTodos({ status: 200 }),
    pendente: { tarefa: '081', motivo: 'GET /api/auditoria/lotes/{id} ainda não existe na API' },
  },
  {
    metodo: 'GET',
    caminho: '/api/auditoria/chaves',
    comCsrf: igualParaTodos({ status: 200 }),
    pendente: { tarefa: '081', motivo: 'GET /api/auditoria/chaves ainda não existe na API' },
  },
];

const chaveDe = (o: { metodo: string; caminho: string }): string =>
  `${o.metodo.toUpperCase()} ${o.caminho}`;

describe('cobertura da matriz', () => {
  it('cobre toda operação do openapi.yaml, e só elas', () => {
    const doContrato = operacoesDoContrato().map(chaveDe).sort();

    expect(OPERACOES.map(chaveDe).sort()).toEqual(doContrato);
    expect(new Set(doContrato).size).toBe(doContrato.length);
  });

  it('derivar o CSRF do método: leituras não exigem, escritas exigem', () => {
    expect(exigeCsrf('GET', '/api/lotes')).toBe(false);
    expect(exigeCsrf('post', '/api/painel/lotes')).toBe(true);
  });

  it('método não declarado em caminho existente dá erro claro', () => {
    expect(() => exigeCsrf('POST', '/api/lotes')).toThrow(
      'contrato: operação POST /api/lotes não existe',
    );
    expect(() => exigeCsrf('GET', '/api/nao-existe')).toThrow(/não existe/);
  });
});

describe.skipIf(!INFRA_DISPONIVEL)(
  'matriz papel × operação (Postgres, Redis e Scryfall falsa)',
  () => {
    let app: NestFastifyApplication;
    let scryfall: ScryfallFalsa;
    let pool: pg.Pool;
    let redis: Awaited<ReturnType<typeof clienteDeTeste>>;
    const prefixoDoLimite = `ratelimit:teste-${randomUUID()}:`;
    const prefixoDaScryfall = novoPrefixoDaScryfall();
    const usuarios: string[] = [];
    let proximoIp = 1;

    beforeAll(async () => {
      scryfall = await iniciarScryfallFalsa();
      const base = envReal();
      app = await criarAppDeTeste({
        env: { ...base, scryfall: { ...base.scryfall, baseUrl: scryfall.url } },
        clientesReais: true,
        prefixoDoLimite,
        prefixoDaScryfall,
      });
      pool = new pg.Pool(BANCO.conexao());
      redis = await clienteDeTeste(REDIS.conexao());
      const dono = await inserirUsuario(pool, 'leiloeiro');
      usuarios.push(dono.id);
      const lote = await inserirLote(pool, dono.id, { titulo: 'Lote da matriz' });
      alvo.loteId = lote.id;
      alvo.snapshotId = lote.snapshotId;
    });

    afterAll(async () => {
      const criados = await pool.query<{ snapshot_id: string }>(
        'delete from lots where titulo = $1 returning snapshot_id',
        [TITULO_CRIADO],
      );
      await pool.query('delete from card_snapshots where id = any($1::uuid[])', [
        criados.rows.map((r) => r.snapshot_id),
      ]);
      await apagarLotesEUsuarios(pool, usuarios);
      await pool.end();
      await apagarChavesDaScryfall(redis, prefixoDaScryfall);
      await apagarChavesDoPrefixo(redis, prefixoDoLimite);
      redis.destroy();
      await app.close();
      await scryfall.fechar();
    });

    /** Um IP novo por caso: o limite de 5 por minuto por IP nunca interfere na matriz. */
    function ipNovo(): string {
      return `10.43.${Math.floor(proximoIp / 250)}.${(proximoIp++ % 250) + 1}`;
    }

    async function navegadorDe(papel: Papel): Promise<Navegador> {
      const navegador = new Navegador(app, ipNovo());
      if (papel === 'anonimo') {
        await navegador.obterCsrf();
      } else {
        const { resposta } = await cadastrar(navegador, { papel });
        expect(resposta.statusCode).toBe(201);
      }
      return navegador;
    }

    async function chamar(
      navegador: Navegador,
      operacao: Operacao,
      email: string,
      comCsrf: boolean,
    ): Promise<LightMyRequestResponse> {
      const csrf = navegador.cookies.get('csrf_token');
      const headers: Record<string, string> = {
        cookie: navegador.cabecalhoCookie(),
        ...(operacao.extras?.() ?? {}),
      };
      if (comCsrf && csrf !== undefined) {
        headers['x-csrf-token'] = csrf;
      }
      return app.inject({
        method: operacao.metodo,
        url: operacao.url?.() ?? operacao.caminho,
        headers,
        ...(operacao.corpo ? { payload: operacao.corpo(email) } : {}),
      });
    }

    async function contaExistente(): Promise<string> {
      const { email, resposta } = await cadastrar(new Navegador(app, ipNovo()));
      expect(resposta.statusCode).toBe(201);
      return email;
    }

    describe.each(OPERACOES.filter((o) => o.pendente !== undefined))(
      'pendente: $metodo $caminho',
      (operacao) => {
        const { tarefa, motivo } = operacao.pendente ?? { tarefa: '?', motivo: '?' };
        for (const papel of PAPEIS) {
          it.todo(`${papel} com CSRF válido (task ${tarefa}: ${motivo})`);
          it.todo(`${papel} sem o header X-CSRF-Token (task ${tarefa}: ${motivo})`);
        }
      },
    );

    describe.each(OPERACOES.filter((o) => o.pendente === undefined))(
      '$metodo $caminho',
      (operacao) => {
        it.each(PAPEIS)('%s com CSRF válido', async (papel) => {
          const navegador = await navegadorDe(papel);
          const email = await contaExistente();

          const resposta = await chamar(navegador, operacao, email, true);

          const esperado = operacao.comCsrf[papel];
          expect(resposta.statusCode).toBe(esperado.status);
          if (esperado.codigo !== undefined) {
            expect((resposta.json() as { erro: { codigo: string } }).erro.codigo).toBe(
              esperado.codigo,
            );
          }
        });

        it.each(PAPEIS)('%s sem o header X-CSRF-Token', async (papel) => {
          const navegador = await navegadorDe(papel);
          const email = await contaExistente();

          const resposta = await chamar(navegador, operacao, email, false);

          if (exigeCsrf(operacao.metodo, operacao.caminho)) {
            expect(resposta.statusCode).toBe(403);
            expect((resposta.json() as { erro: { codigo: string } }).erro.codigo).toBe(
              'CSRF_INVALIDO',
            );
          } else {
            expect(resposta.statusCode).toBe(operacao.comCsrf[papel].status);
          }
        });
      },
    );
  },
);
