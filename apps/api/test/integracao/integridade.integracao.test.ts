// Integração (Postgres e Redis reais): as adulterações do histórico são detectadas pela auditoria do
// servidor, `GET /api/auditoria/lotes/{id}` (tarefa 089; specs/008 §Verificação e critérios de
// aceite, ADR 0005 e 0031). Cada caso semeia uma cadeia assinada de verdade, aplica UMA adulteração
// por SQL com o dono do esquema e os triggers de `bids` desligados só dentro da transação do teste
// (`adulterarPorSql`, com rollback em qualquer falha), chama a rota pública e confere o veredito,
// o código e o `seq` de cada problema. Depois de cada teste os triggers têm de estar como antes.
// Toda resposta passa pela varredura de privacidade e é validada contra o openapi pelo app de teste.
import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BANCO as TOKEN_DO_BANCO } from '../../src/config/banco.module.js';
import type { Banco } from '../../src/db/banco.js';
import { CadeiaDeLances, registrarChaveDeAssinatura } from '../../src/modules/lances/index.js';
import {
  type ChavesDeAssinatura,
  derivarChaves,
} from '../../src/modules/lances/integridade/assinatura.js';
import {
  adulterarPorSql,
  alterarValorDoLance,
  apagarLances,
  assumirPapelDaApi,
  codigoDaFalha,
  emTransacaoDesfeita,
  estadoDosTriggers,
  falhaDe,
  PAPEL_DA_API,
  validarTabelaDeIntegridade,
  inserirLanceAssinado,
  lerCadeia,
  lerCadeiaDoPool,
  recalcularCadeiaSemAChave,
  type EstadoDeTrigger,
  type TabelaDeIntegridade,
  TABELAS_DE_INTEGRIDADE,
} from '../helpers/adulterar-por-sql.js';
import { encerrarPorSql } from '../helpers/lances-por-sql.js';
import { type ContaPorSql, inserirLote, inserirUsuario } from '../helpers/lotes-por-sql.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../modules/identidade/ambiente.js';

/** Limite de teste e de hook: a máquina roda muitos arquivos em paralelo contra o mesmo Postgres. */
const TIMEOUT_LONGO_MS = 90_000;
const HORA_MS = 60 * 60 * 1000;
const SEM_PRIVILEGIO = '42501';
const APPEND_ONLY = '23001';
const VALOR_ADULTERADO_CENTAVOS = 99_999;
const VALOR_FORJADO_CENTAVOS = 500_000;
/** Cada cenário tem 3 lances: o do meio é o seq 2. */
const LANCES_DO_CENARIO = 3;

interface LanceJson {
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly hash: string;
  readonly keyId: string;
}

interface AuditoriaJson {
  readonly lote: { readonly id: string; readonly totalLances: number };
  readonly lances: readonly LanceJson[];
  readonly selo: { readonly hashFinal: string; readonly totalLances: number } | null;
  readonly veredito: 'integro' | 'adulterado';
  readonly problemas: readonly { codigo: string; seq: number | null; mensagem: string }[];
}

interface ChaveJson {
  readonly keyId: string;
  readonly algoritmo: string;
  readonly chavePublica: string;
  readonly ativaDesde: string;
}

interface Cenario {
  readonly loteId: string;
  /** Todas as contas que tocam o lote: nenhum dado delas pode aparecer na resposta. */
  readonly contas: readonly ContaPorSql[];
  readonly autor: ContaPorSql;
}

type Par = readonly [codigo: string, seq: number | null];

describe('helper de adulteração: tabela fora da lista fechada', () => {
  it('lança erro claro sem tocar o banco', async () => {
    const conectar = vi.fn();
    const poolFalso = { connect: conectar } as unknown as pg.Pool;

    await expect(
      adulterarPorSql(poolFalso, ['bids; drop table users' as TabelaDeIntegridade], async () => 1),
    ).rejects.toThrow(/fora da lista de integridade/);
    expect(() => validarTabelaDeIntegridade('users')).toThrow(/fora da lista de integridade/);
    expect(conectar).not.toHaveBeenCalled();
  });
});

describe.skipIf(!INFRA_DISPONIVEL)(
  'integridade: adulterações detectadas (Postgres real)',
  { timeout: TIMEOUT_LONGO_MS },
  () => {
    let ctx: AppDeIdentidade;
    let pool: pg.Pool;
    let banco: Banco;
    let cadeia: CadeiaDeLances;
    let leiloeiro: ContaPorSql;
    let triggersIniciais: readonly EstadoDeTrigger[];
    /** Quem forja não tem a chave do servidor: usa a sua, que nunca entra em `signing_keys`. */
    const atacante: ChavesDeAssinatura = derivarChaves(new Uint8Array(randomBytes(32)));
    /** Relógio dos lances semeados: cresce 1 s por lance. */
    let relogio = Date.now() - 3 * HORA_MS;

    beforeAll(async () => {
      ctx = await criarAppDeIdentidade();
      await registrarChaveDeAssinatura(ctx.app);
      pool = new pg.Pool(BANCO.conexao());
      banco = ctx.app.get<Banco>(TOKEN_DO_BANCO);
      cadeia = ctx.app.get(CadeiaDeLances);
      leiloeiro = await inserirUsuario(pool, 'leiloeiro');
      triggersIniciais = await estadoDosTriggers(pool);
    }, TIMEOUT_LONGO_MS);

    afterAll(async () => {
      await pool.end();
      await ctx.fechar();
    }, TIMEOUT_LONGO_MS);

    // Os triggers append-only têm de voltar ao estado original ao fim de cada teste, qualquer que
    // tenha sido o resultado dele.
    afterEach(async () => {
      expect(await estadoDosTriggers(pool)).toEqual(triggersIniciais);
    }, TIMEOUT_LONGO_MS);

    async function semear(loteId: string, quem: ContaPorSql, valorCentavos: number): Promise<void> {
      relogio += 1000;
      await banco.transaction((tx) =>
        cadeia.anexar(tx, {
          loteId,
          licitanteId: quem.id,
          valorCentavos,
          criadoEm: new Date(relogio),
          idempotencyKey: randomUUID(),
        }),
      );
      await pool.query(
        `update lots set lance_atual_centavos = $2, lider_id = $3, total_lances = total_lances + 1
        where id = $1`,
        [loteId, valorCentavos, quem.id],
      );
    }

    /** Lote com `LANCES_DO_CENARIO` lances de dois licitantes; `selado` o encerra e grava o selo. */
    async function cenario(selado: boolean): Promise<Cenario> {
      const a = await inserirUsuario(pool, 'licitante');
      const b = await inserirUsuario(pool, 'licitante');
      const { id: loteId } = await inserirLote(pool, leiloeiro.id, {
        lance_inicial_centavos: 1000,
        incremento_minimo_centavos: 100,
      });
      for (let i = 0; i < LANCES_DO_CENARIO; i += 1) {
        await semear(loteId, i % 2 === 0 ? a : b, 1000 + i * 100);
      }
      if (selado) {
        await encerrarPorSql(pool, loteId, { status: 'encerrado', vencedorId: a.id });
        await banco.transaction((tx) =>
          cadeia.selar(tx, { loteId, status: 'encerrado', seladoEm: new Date() }),
        );
      }
      return { loteId, contas: [leiloeiro, a, b], autor: a };
    }

    /** `GET` da auditoria: 200, sem cache e sem nenhum dado de usuário no corpo. */
    async function auditar(c: Cenario): Promise<AuditoriaJson> {
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: `/api/auditoria/lotes/${c.loteId}`,
      });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store');
      semDadosDeUsuario(resposta.body, c.contas);
      return resposta.json<{ dados: AuditoriaJson }>().dados;
    }

    function semDadosDeUsuario(corpo: string, contas: readonly ContaPorSql[]): void {
      for (const conta of contas) {
        expect(corpo).not.toContain(conta.id);
        expect(corpo).not.toContain(conta.nome);
        expect(corpo).not.toContain(conta.email);
      }
      expect(corpo).not.toMatch(/licitante_?id|liderId|vencedorId|"email"|"nome"/i);
    }

    const pares = (a: AuditoriaJson): Par[] => a.problemas.map((p) => [p.codigo, p.seq]);

    describe('caso base: o histórico intacto é íntegro', () => {
      it('lote ao vivo: veredito integro, sem problemas, sem selo', async () => {
        const c = await cenario(false);

        const corpo = await auditar(c);

        expect(corpo.veredito).toBe('integro');
        expect(corpo.problemas).toEqual([]);
        expect(corpo.selo).toBeNull();
        expect(corpo.lances.map((l) => l.seq)).toEqual([1, 2, 3]);
        expect((await lerCadeiaDoPool(pool, c.loteId)).map((l) => l.hash)).toEqual(
          corpo.lances.map((l) => l.hash),
        );
      });

      it('lote selado: veredito integro, com o selo do total e do hash final', async () => {
        const c = await cenario(true);

        const corpo = await auditar(c);

        expect(corpo.veredito).toBe('integro');
        expect(corpo.problemas).toEqual([]);
        expect(corpo.selo).toMatchObject({
          totalLances: LANCES_DO_CENARIO,
          hashFinal: corpo.lances.at(-1)?.hash,
        });
      });
    });

    describe('1. valor alterado', () => {
      it.each([1, 2, 3])(
        'lote selado, valor do lance %i alterado → só HASH_DIVERGENTE nesse seq',
        async (seq) => {
          const c = await cenario(true);
          await adulterarPorSql(pool, ['bids'], (cliente) =>
            alterarValorDoLance(cliente, c.loteId, seq, VALOR_ADULTERADO_CENTAVOS),
          );

          const corpo = await auditar(c);

          expect(corpo.veredito).toBe('adulterado');
          expect(pares(corpo)).toEqual([['HASH_DIVERGENTE', seq]]);
          // A resposta mostra o valor adulterado: é o que o navegador recalcula.
          expect(corpo.lances[seq - 1]?.valorCentavos).toBe(VALOR_ADULTERADO_CENTAVOS);
        },
      );
    });

    describe('2. lance do meio apagado', () => {
      it.each([
        [
          'ao vivo',
          false,
          [
            ['SEQ_FORA_DE_ORDEM', 3],
            ['HASH_ANTERIOR_DIVERGENTE', 3],
          ],
        ],
        [
          'selado (o total do selo também diverge)',
          true,
          [
            ['SEQ_FORA_DE_ORDEM', 3],
            ['HASH_ANTERIOR_DIVERGENTE', 3],
            ['SELO_TOTAL_DIVERGENTE', null],
          ],
        ],
      ] as const)(
        'lote %s → seq 3 fora de ordem e hash anterior divergente',
        async (_, selado, esperado) => {
          const c = await cenario(selado);
          await adulterarPorSql(pool, ['bids'], (cliente) => apagarLances(cliente, c.loteId, [2]));

          const corpo = await auditar(c);

          expect(corpo.veredito).toBe('adulterado');
          expect(pares(corpo)).toEqual(esperado);
          expect(corpo.lances.map((l) => l.seq)).toEqual([1, 3]);
        },
      );
    });

    describe('3. lance inserido', () => {
      it('no fim da cadeia, encadeado e com hash correto mas assinado sem a chave → ASSINATURA_INVALIDA', async () => {
        const c = await cenario(false);
        await adulterarPorSql(pool, [], async (cliente) => {
          await inserirLanceAssinado(cliente, forjado(c, await chaveDoServidor(cliente, c)));
        });

        const corpo = await auditar(c);

        expect(corpo.veredito).toBe('adulterado');
        expect(pares(corpo)).toEqual([['ASSINATURA_INVALIDA', 4]]);
      });

      it('com um buraco na sequência → SEQ_FORA_DE_ORDEM e ASSINATURA_INVALIDA no seq inserido', async () => {
        const c = await cenario(false);
        await adulterarPorSql(pool, [], async (cliente) => {
          await inserirLanceAssinado(cliente, {
            ...forjado(c, await chaveDoServidor(cliente, c)),
            seq: 6,
          });
        });

        const corpo = await auditar(c);

        expect(corpo.veredito).toBe('adulterado');
        expect(pares(corpo)).toEqual([
          ['SEQ_FORA_DE_ORDEM', 6],
          ['ASSINATURA_INVALIDA', 6],
        ]);
      });

      it('em lote selado, o selo acusa total e hash final → além da assinatura do lance', async () => {
        const c = await cenario(true);
        await adulterarPorSql(pool, [], async (cliente) => {
          await inserirLanceAssinado(cliente, forjado(c, await chaveDoServidor(cliente, c)));
        });

        const corpo = await auditar(c);

        expect(corpo.veredito).toBe('adulterado');
        expect(pares(corpo)).toEqual([
          ['ASSINATURA_INVALIDA', 4],
          ['SELO_TOTAL_DIVERGENTE', null],
          ['SELO_HASH_FINAL_DIVERGENTE', null],
        ]);
      });
    });

    describe('4. cadeia recalculada sem a chave', () => {
      it.each([
        ['ao vivo', false, [] as const],
        [
          'selado (o hash final do selo também diverge)',
          true,
          [['SELO_HASH_FINAL_DIVERGENTE', null]],
        ],
      ] as const)(
        'lote %s: hashes e encadeamento coerentes por dentro, mas assinados sem a chave',
        async (_, selado, doSelo) => {
          const c = await cenario(selado);
          await adulterarPorSql(pool, ['bids'], (cliente) =>
            recalcularCadeiaSemAChave(cliente, c.loteId, {
              aPartirDoSeq: 2,
              valorCentavos: VALOR_ADULTERADO_CENTAVOS,
              chaves: atacante,
            }),
          );

          const corpo = await auditar(c);

          // Nenhum problema de hash nem de encadeamento: só a assinatura denuncia, no seq 2 e no 3.
          expect(corpo.veredito).toBe('adulterado');
          expect(pares(corpo)).toEqual([
            ['ASSINATURA_INVALIDA', 2],
            ['ASSINATURA_INVALIDA', 3],
            ...doSelo,
          ]);
          expect(corpo.lances[1]?.valorCentavos).toBe(VALOR_ADULTERADO_CENTAVOS);
          // A chave de quem recalcula não é publicada: só a do servidor verifica as assinaturas.
          const resposta = await ctx.app.inject({ method: 'GET', url: '/api/auditoria/chaves' });
          const ids = resposta.json<{ dados: ChaveJson[] }>().dados.map((k) => k.keyId);
          expect(ids).not.toContain(atacante.keyId);
          expect(corpo.lances.every((l) => ids.includes(l.keyId))).toBe(true);
        },
      );
    });

    describe('5. fim de um lote selado truncado', () => {
      it.each([1, 2, LANCES_DO_CENARIO])(
        'últimos %i lances apagados → SELO_TOTAL_DIVERGENTE e SELO_HASH_FINAL_DIVERGENTE',
        async (quantos) => {
          const c = await cenario(true);
          const seqs = Array.from({ length: quantos }, (_, i) => LANCES_DO_CENARIO - i);
          await adulterarPorSql(pool, ['bids'], (cliente) => apagarLances(cliente, c.loteId, seqs));

          const corpo = await auditar(c);

          // A cadeia que sobrou é coerente: só o selo, que guarda total e hash final, acusa.
          expect(corpo.veredito).toBe('adulterado');
          expect(pares(corpo)).toEqual([
            ['SELO_TOTAL_DIVERGENTE', null],
            ['SELO_HASH_FINAL_DIVERGENTE', null],
          ]);
          expect(corpo.lances).toHaveLength(LANCES_DO_CENARIO - quantos);
          expect(corpo.selo?.totalLances).toBe(LANCES_DO_CENARIO);
        },
      );
    });

    describe('a adulteração de teste não deixa rastro', () => {
      it('falha no meio da adulteração: rollback, triggers ligados e histórico intacto', async () => {
        const c = await cenario(true);
        const antes = await lerCadeiaDoPool(pool, c.loteId);

        await expect(
          adulterarPorSql(pool, ['bids'], async (cliente) => {
            await alterarValorDoLance(cliente, c.loteId, 2, VALOR_ADULTERADO_CENTAVOS);
            throw new Error('falha provocada pelo teste');
          }),
        ).rejects.toThrow('falha provocada pelo teste');

        expect(await lerCadeiaDoPool(pool, c.loteId)).toEqual(antes);
        expect(await estadoDosTriggers(pool)).toEqual(triggersIniciais);
        expect((await auditar(c)).veredito).toBe('integro');
        // Fora da adulteração o dono também é recusado pelo trigger.
        await emTransacaoDesfeita(pool, async (cliente) => {
          expect(
            await codigoDaFalha(cliente, 'delete from bids where lote_id = $1', [c.loteId]),
          ).toBe(APPEND_ONLY);
        });
      });
    });

    describe('o papel da API não consegue as mesmas alterações', () => {
      const alteracoes = (tabela: TabelaDeIntegridade, loteId: string): [string, unknown[]][] => {
        switch (tabela) {
          case 'bids':
            return [
              ['update bids set valor_centavos = valor_centavos + 1 where lote_id = $1', [loteId]],
              ['delete from bids where lote_id = $1', [loteId]],
            ];
          case 'lot_seals':
            return [
              ['update lot_seals set total_lances = total_lances + 1 where lote_id = $1', [loteId]],
              ['delete from lot_seals where lote_id = $1', [loteId]],
            ];
          case 'signing_keys':
            return [
              ['update signing_keys set ativa_desde = ativa_desde', []],
              ['delete from signing_keys', []],
            ];
        }
      };

      // Migration 0003: leilao_api recebe só SELECT e INSERT nas três tabelas.
      const CONCEDIDOS = ['SELECT', 'INSERT'] as const;
      const NEGADOS = ['UPDATE', 'DELETE', 'TRUNCATE'] as const;

      it.each(TABELAS_DE_INTEGRIDADE)(
        'como leilao_api: UPDATE, DELETE, TRUNCATE e desligar trigger em %s dão 42501',
        async (tabelaBruta) => {
          const tabela = validarTabelaDeIntegridade(tabelaBruta);
          const c = await cenario(true);
          await emTransacaoDesfeita(pool, async (cliente) => {
            await assumirPapelDaApi(cliente);

            // Controle positivo: o papel tem USAGE no schema e os grants esperados, então o 42501
            // abaixo vem mesmo da falta de UPDATE/DELETE/TRUNCATE/dono, não de outra causa.
            const tem = async (privilegio: string): Promise<boolean> =>
              (
                await cliente.query<{ ok: boolean }>(
                  'select has_table_privilege($1, $2, $3) as ok',
                  [PAPEL_DA_API, tabela, privilegio],
                )
              ).rows[0]?.ok === true;
            for (const privilegio of CONCEDIDOS)
              expect(await tem(privilegio), privilegio).toBe(true);
            for (const privilegio of NEGADOS) expect(await tem(privilegio), privilegio).toBe(false);
            expect(
              (await cliente.query(`select 1 from ${tabela} limit 1`)).rowCount,
            ).toBeGreaterThanOrEqual(0);

            for (const [sql, parametros] of alteracoes(tabela, c.loteId)) {
              const falha = await falhaDe(cliente, sql, parametros);
              expect(falha.codigo, sql).toBe(SEM_PRIVILEGIO);
              expect(falha.mensagem, sql).toMatch(
                new RegExp(`permission denied for table ${tabela}\\b`),
              );
            }
            const truncar = await falhaDe(cliente, `truncate ${tabela}`);
            expect(truncar.codigo).toBe(SEM_PRIVILEGIO);
            expect(truncar.mensagem).toMatch(
              new RegExp(`permission denied for table ${tabela}\\b`),
            );
            const desligar = await falhaDe(cliente, `alter table ${tabela} disable trigger user`);
            expect(desligar.codigo).toBe(SEM_PRIVILEGIO);
            expect(desligar.mensagem).toMatch(new RegExp(`must be owner of table ${tabela}\\b`));
          });

          expect((await auditar(c)).veredito).toBe('integro');
        },
      );

      it.each(TABELAS_DE_INTEGRIDADE)(
        'até o dono, com os triggers ligados, leva 23001 no UPDATE e no DELETE de %s',
        async (tabela) => {
          const c = await cenario(true);
          await emTransacaoDesfeita(pool, async (cliente) => {
            for (const [sql, parametros] of alteracoes(tabela, c.loteId)) {
              expect(await codigoDaFalha(cliente, sql, parametros), sql).toBe(APPEND_ONLY);
            }
          });

          expect((await auditar(c)).veredito).toBe('integro');
        },
      );
    });

    describe('rotação simulada de chave', () => {
      it('a chave antiga segue publicada: lote antigo e lote assinado com a chave nova são íntegros', async () => {
        const antigo = await cenario(true);
        const keyIdAntigo = (await auditar(antigo)).lances[0]?.keyId ?? '';
        // O boot com a chave nova a registraria assim; a antiga não sai de `signing_keys`.
        const nova = derivarChaves(new Uint8Array(randomBytes(32)));
        await pool.query('insert into signing_keys (key_id, chave_publica) values ($1, $2)', [
          nova.keyId,
          Buffer.from(nova.chavePublica),
        ]);
        // Lote aberto depois da rotação: dois lances encadeados desde a gênese, só com a chave nova.
        const autor = await inserirUsuario(pool, 'licitante');
        const { id: loteRecente } = await inserirLote(pool, leiloeiro.id);
        const recente: Cenario = { loteId: loteRecente, contas: [leiloeiro, autor], autor };
        await adulterarPorSql(pool, [], async (cliente) => {
          for (const valorCentavos of [1000, 1100]) {
            await inserirLanceAssinado(cliente, {
              loteId: recente.loteId,
              licitanteId: autor.id,
              pseudonimo: 'Licitante #a1b2c3',
              valorCentavos,
              chaves: nova,
            });
          }
        });

        const chaves = (
          await ctx.app.inject({ method: 'GET', url: '/api/auditoria/chaves' })
        ).json<{
          dados: ChaveJson[];
        }>().dados;
        const ids = chaves.map((k) => k.keyId);

        expect(ids).toContain(keyIdAntigo);
        expect(ids.indexOf(keyIdAntigo)).toBeLessThan(ids.indexOf(nova.keyId));
        const antigoDepois = await auditar(antigo);
        expect(antigoDepois.veredito).toBe('integro');
        expect(antigoDepois.lances.every((l) => l.keyId === keyIdAntigo)).toBe(true);
        const recenteDepois = await auditar(recente);
        expect(recenteDepois.veredito).toBe('integro');
        expect(recenteDepois.problemas).toEqual([]);
        expect(recenteDepois.lances.map((l) => l.keyId)).toEqual([nova.keyId, nova.keyId]);
      });
    });

    // ---- apoio dos cenários ----

    /** Lance forjado no fim da cadeia, em nome do autor do cenário, assinado por `atacante`. */
    function forjado(
      c: Cenario,
      keyIdDoServidor: string,
    ): Parameters<typeof inserirLanceAssinado>[1] {
      return {
        loteId: c.loteId,
        licitanteId: c.autor.id,
        pseudonimo: 'Licitante #a1b2c3',
        valorCentavos: VALOR_FORJADO_CENTAVOS,
        chaves: atacante,
        keyId: keyIdDoServidor,
      };
    }

    /** `key_id` que o servidor usou nos lances do cenário: o forjado o imita, a assinatura não. */
    async function chaveDoServidor(cliente: pg.ClientBase, c: Cenario): Promise<string> {
      const keyId = (await lerCadeia(cliente, c.loteId))[0]?.keyId;
      if (keyId === undefined) throw new Error('cenário sem lances');
      return keyId;
    }
  },
);
