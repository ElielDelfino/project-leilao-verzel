// Integração (Postgres real): interface pública de lotes para o módulo liquidacao (tarefa 104,
// specs/006 §Interface interna para `liquidacao`). Fixtures por SQL; tudo apagado no afterAll.
// O banco é compartilhado com outros arquivos em paralelo: varreduras globais (iniciar, candidatos)
// rodam em transação desfeita no fim ou só conferem os ids deste arquivo.
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type BancoVerificavel, criarBanco, type Transacao } from '../../../src/db/banco.js';
import {
  cancelarLote,
  candidatosAoEncerramento,
  encerrarLote,
  ErroDeLote,
  iniciarLotesPendentes,
  travarLoteVencido,
} from '../../../src/modules/lotes/index.js';
import { TIMEOUT_LONGO_MS } from '../../helpers/cliente-socket.js';
import {
  apagarLotesEUsuarios,
  inserirLote,
  inserirUsuario,
  iso,
} from '../../helpers/lotes-por-sql.js';
import { BANCO } from '../identidade/ambiente.js';

const ID_INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
/** Limite folgado para as varreduras globais acharem os lotes deste arquivo no banco partilhado. */
const LIMITE_FOLGADO = 10_000;
/** A segunda transação com SKIP LOCKED não espera: bem abaixo do lock_timeout de 5 s. */
const SEM_ESPERA_MS = 2_000;

/** Lança para desfazer a transação sem efeito global; o valor útil vai junto. */
class Desfazer<T> extends Error {
  constructor(readonly valor: T) {
    super('rollback proposital do teste');
  }
}

describe.skipIf(!BANCO.disponivel)('lotes: interface para liquidacao (Postgres real)', () => {
  let banco: BancoVerificavel;
  let pool: pg.Pool;
  const usuarios: string[] = [];
  let leiloeiro = '';
  let licitante = '';

  /** Roda `fn` numa transação que sempre é desfeita e devolve o resultado. */
  async function emTransacaoDesfeita<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    try {
      await banco.transaction(async (tx) => {
        throw new Desfazer(await fn(tx));
      });
    } catch (erro) {
      if (erro instanceof Desfazer) return erro.valor as T;
      throw erro;
    }
    throw new Error('a transação desfeita não lançou');
  }

  async function linha(id: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query<Record<string, unknown>>(
      `select status, vencedor_id, valor_arremate_centavos::int as valor, encerrado_em,
              cancelado_em
         from lots where id = $1`,
      [id],
    );
    const r = rows[0];
    if (r === undefined) throw new Error(`lote ${id} sumiu`);
    return r;
  }

  const candidatos = (limite: number): Promise<string[]> =>
    banco.consultar((db) => candidatosAoEncerramento(db, limite));

  const vencido = (): Record<string, string> => ({ fim_em: iso(Date.now() - MINUTO) });
  const comLances = (): Record<string, string | number> => ({
    total_lances: 2,
    lance_atual_centavos: 300,
    lider_id: licitante,
  });

  beforeAll(async () => {
    banco = criarBanco({ conexao: BANCO.conexao(), aoErroOcioso: () => undefined });
    pool = new pg.Pool(BANCO.conexao());
    leiloeiro = (await inserirUsuario(pool, 'leiloeiro')).id;
    licitante = (await inserirUsuario(pool, 'licitante')).id;
    usuarios.push(leiloeiro, licitante);
  });

  afterAll(async () => {
    await apagarLotesEUsuarios(pool, usuarios);
    await pool.end();
    await banco.encerrar();
  });

  describe('iniciarLotesPendentes', () => {
    it('inicia só agendados com inicio_em <= now() e devolve os ids', async () => {
      const pendente = await inserirLote(pool, leiloeiro, { status: 'agendado' });
      const futuro = await inserirLote(pool, leiloeiro, {
        status: 'agendado',
        inicio_em: iso(Date.now() + HORA),
        fim_em: iso(Date.now() + 2 * HORA),
      });
      const jaAoVivo = await inserirLote(pool, leiloeiro);
      const cancelado = await inserirLote(pool, leiloeiro, { status: 'cancelado' });

      const { ids, status } = await emTransacaoDesfeita(async (tx) => {
        const iniciados = await iniciarLotesPendentes(tx, LIMITE_FOLGADO);
        const meus = [pendente.id, futuro.id, jaAoVivo.id, cancelado.id];
        const { rows } = await tx.execute<{ id: string; status: string }>(
          sql`select id, status from lots where id in (${sql.join(meus, sql`, `)})`,
        );
        return { ids: iniciados, status: new Map(rows.map((r) => [r.id, r.status])) };
      });

      expect(ids).toContain(pendente.id);
      expect(ids).not.toContain(futuro.id);
      expect(ids).not.toContain(jaAoVivo.id);
      expect(ids).not.toContain(cancelado.id);
      expect(status.get(pendente.id)).toBe('ao_vivo');
      expect(status.get(futuro.id)).toBe('agendado');
      expect(status.get(cancelado.id)).toBe('cancelado');
    });

    it('respeita o limite', async () => {
      await inserirLote(pool, leiloeiro, { status: 'agendado' });
      await inserirLote(pool, leiloeiro, { status: 'agendado' });

      const ids = await emTransacaoDesfeita((tx) => iniciarLotesPendentes(tx, 1));

      expect(ids).toHaveLength(1);
    });

    it('recusa limite que não é inteiro positivo', async () => {
      await expect(banco.transaction((tx) => iniciarLotesPendentes(tx, 0))).rejects.toThrow(
        RangeError,
      );
    });
  });

  describe('candidatosAoEncerramento', () => {
    it('lista ao_vivo vencidos por fim_em crescente, sem os demais', async () => {
      const maisAntigo = await inserirLote(pool, leiloeiro, {
        fim_em: iso(Date.now() - 2 * MINUTO),
      });
      const maisNovo = await inserirLote(pool, leiloeiro, vencido());
      const aberto = await inserirLote(pool, leiloeiro);
      const encerrado = await inserirLote(pool, leiloeiro, { ...vencido(), status: 'encerrado' });

      const ids = await candidatos(LIMITE_FOLGADO);

      expect(ids.indexOf(maisAntigo.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(maisAntigo.id)).toBeLessThan(ids.indexOf(maisNovo.id));
      expect(ids).not.toContain(aberto.id);
      expect(ids).not.toContain(encerrado.id);
    });

    it('respeita o limite', async () => {
      await inserirLote(pool, leiloeiro, vencido());
      await inserirLote(pool, leiloeiro, vencido());

      await expect(candidatos(1)).resolves.toHaveLength(1);
    });

    it('deixa de fora os ids em backoff e mantém os demais', async () => {
      const veneno = await inserirLote(pool, leiloeiro, vencido());
      const saudavel = await inserirLote(pool, leiloeiro, vencido());

      const ids = await banco.consultar((db) =>
        candidatosAoEncerramento(db, LIMITE_FOLGADO, [veneno.id]),
      );

      expect(ids).not.toContain(veneno.id);
      expect(ids).toContain(saudavel.id);
    });
  });

  describe('travarLoteVencido', () => {
    it('devolve o lote ao vivo vencido', async () => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });

      const travado = await banco.transaction((tx) => travarLoteVencido(tx, id));

      expect(travado).toMatchObject({ id, status: 'ao_vivo', liderId: licitante, totalLances: 2 });
    });

    it('devolve null para lote aberto, encerrado, cancelado ou inexistente', async () => {
      const aberto = await inserirLote(pool, leiloeiro);
      const encerrado = await inserirLote(pool, leiloeiro, { ...vencido(), status: 'encerrado' });
      const cancelado = await inserirLote(pool, leiloeiro, { ...vencido(), status: 'cancelado' });

      for (const id of [aberto.id, encerrado.id, cancelado.id, ID_INEXISTENTE]) {
        await expect(banco.transaction((tx) => travarLoteVencido(tx, id))).resolves.toBeNull();
      }
    });

    it(
      'duas transações simultâneas: só uma recebe a linha, a outra null sem esperar',
      async () => {
        const { id } = await inserirLote(pool, leiloeiro, vencido());
        let liberar: () => void = () => undefined;
        const segura = new Promise<void>((resolve) => {
          liberar = resolve;
        });
        let avisarQueTravou: () => void = () => undefined;
        const travou = new Promise<void>((resolve) => {
          avisarQueTravou = resolve;
        });

        const primeira = banco.transaction(async (tx) => {
          try {
            return await travarLoteVencido(tx, id);
          } finally {
            // Também no caminho de erro, para a espera abaixo nunca pendurar o teste; o lock
            // continua de pé até `liberar()`, porque a transação só termina depois do finally.
            avisarQueTravou();
            await segura;
          }
        });
        const medirSegunda = async (): Promise<{ lote: unknown; decorrido: number }> => {
          const inicio = Date.now();
          const lote = await banco.transaction((tx) => travarLoteVencido(tx, id));
          return { lote, decorrido: Date.now() - inicio };
        };
        let segunda: { lote: unknown; decorrido: number } | undefined;
        try {
          await Promise.race([travou, primeira]);
          segunda = await medirSegunda();
        } finally {
          liberar();
        }

        expect(segunda?.lote).toBeNull();
        expect(segunda?.decorrido).toBeLessThan(SEM_ESPERA_MS);
        expect((await primeira)?.id).toBe(id);
      },
      TIMEOUT_LONGO_MS,
    );

    it('devolve null se o anti-sniping estendeu o fim depois da varredura', async () => {
      const { id } = await inserirLote(pool, leiloeiro, vencido());
      expect(await candidatos(LIMITE_FOLGADO)).toContain(id);
      await pool.query('update lots set fim_em = $2 where id = $1', [id, iso(Date.now() + HORA)]);

      await expect(banco.transaction((tx) => travarLoteVencido(tx, id))).resolves.toBeNull();
    });
  });

  describe('encerrarLote', () => {
    it('grava encerrado com vencedor, valor e encerrado_em', async () => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });
      const encerradoEm = new Date();

      await banco.transaction((tx) =>
        encerrarLote(tx, id, { vencedorId: licitante, valorArremateCentavos: 300, encerradoEm }),
      );

      expect(await linha(id)).toEqual({
        status: 'encerrado',
        vencedor_id: licitante,
        valor: 300,
        encerrado_em: encerradoEm,
        cancelado_em: null,
      });
    });

    it('encerra sem vencedor o lote sem lances', async () => {
      const { id } = await inserirLote(pool, leiloeiro, vencido());
      const encerradoEm = new Date();

      await banco.transaction((tx) =>
        encerrarLote(tx, id, { vencedorId: null, valorArremateCentavos: null, encerradoEm }),
      );

      expect(await linha(id)).toMatchObject({
        status: 'encerrado',
        vencedor_id: null,
        valor: null,
      });
    });

    it('recusa lote já encerrado', async () => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), status: 'encerrado' });

      await expect(
        banco.transaction((tx) =>
          encerrarLote(tx, id, {
            vencedorId: null,
            valorArremateCentavos: null,
            encerradoEm: new Date(),
          }),
        ),
      ).rejects.toMatchObject({ name: 'ErroDeLote', codigo: 'ESTADO_INVALIDO' });
    });

    it('recusa vencedor sem valor, sem mudar o lote', async () => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });

      const erro: unknown = await banco
        .transaction((tx) =>
          encerrarLote(tx, id, {
            vencedorId: licitante,
            valorArremateCentavos: null,
            encerradoEm: new Date(),
          }),
        )
        .catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(ErroDeLote);
      expect(erro).toMatchObject({ codigo: 'ARREMATE_INCOERENTE' });
      expect(await linha(id)).toMatchObject({ status: 'ao_vivo' });
    });

    it('recusa encerrar sem vencedor um lote com lances, e vice-versa', async () => {
      const comLance = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });
      const semLance = await inserirLote(pool, leiloeiro, vencido());
      const encerradoEm = new Date();

      await expect(
        banco.transaction((tx) =>
          encerrarLote(tx, comLance.id, {
            vencedorId: null,
            valorArremateCentavos: null,
            encerradoEm,
          }),
        ),
      ).rejects.toMatchObject({ codigo: 'ESTADO_INVALIDO' });
      await expect(
        banco.transaction((tx) =>
          encerrarLote(tx, semLance.id, {
            vencedorId: licitante,
            valorArremateCentavos: 300,
            encerradoEm,
          }),
        ),
      ).rejects.toMatchObject({ codigo: 'ESTADO_INVALIDO' });
    });

    it.each([
      ['valor zero', 0],
      ['valor negativo', -100],
    ])('recusa vencedor com %s (ARREMATE_INCOERENTE)', async (_rotulo, valor) => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });

      await expect(
        banco.transaction((tx) =>
          encerrarLote(tx, id, {
            vencedorId: licitante,
            valorArremateCentavos: valor,
            encerradoEm: new Date(),
          }),
        ),
      ).rejects.toMatchObject({ name: 'ErroDeLote', codigo: 'ARREMATE_INCOERENTE' });
      expect(await linha(id)).toMatchObject({ status: 'ao_vivo' });
    });

    it('recusa valor presente com vencedorId nulo (ARREMATE_INCOERENTE)', async () => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });

      await expect(
        banco.transaction((tx) =>
          encerrarLote(tx, id, {
            vencedorId: null,
            valorArremateCentavos: 300,
            encerradoEm: new Date(),
          }),
        ),
      ).rejects.toMatchObject({ name: 'ErroDeLote', codigo: 'ARREMATE_INCOERENTE' });
      expect(await linha(id)).toMatchObject({ status: 'ao_vivo' });
    });

    it('recusa vencedor diferente do líder gravado, sem mudar o lote', async () => {
      const outro = (await inserirUsuario(pool, 'licitante')).id;
      usuarios.push(outro);
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });

      await expect(
        banco.transaction((tx) =>
          encerrarLote(tx, id, {
            vencedorId: outro,
            valorArremateCentavos: 300,
            encerradoEm: new Date(),
          }),
        ),
      ).rejects.toMatchObject({ name: 'ErroDeLote', codigo: 'ESTADO_INVALIDO' });
      expect(await linha(id)).toMatchObject({ status: 'ao_vivo', vencedor_id: null, valor: null });
    });

    it('recusa valor diferente do lance atual gravado, sem mudar o lote', async () => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });

      await expect(
        banco.transaction((tx) =>
          encerrarLote(tx, id, {
            vencedorId: licitante,
            valorArremateCentavos: 299,
            encerradoEm: new Date(),
          }),
        ),
      ).rejects.toMatchObject({ name: 'ErroDeLote', codigo: 'ESTADO_INVALIDO' });
      expect(await linha(id)).toMatchObject({ status: 'ao_vivo', vencedor_id: null, valor: null });
    });
  });

  describe('cancelarLote', () => {
    it('recusa lote ao vivo com fim_em vencido (FIM_VENCIDO) e o mantém ao vivo', async () => {
      const { id } = await inserirLote(pool, leiloeiro, { ...vencido(), ...comLances() });

      await expect(
        banco.transaction((tx) => cancelarLote(tx, id, new Date())),
      ).rejects.toMatchObject({ name: 'ErroDeLote', codigo: 'FIM_VENCIDO' });
      expect(await linha(id)).toMatchObject({ status: 'ao_vivo', cancelado_em: null });
    });

    it('cancela lote agendado e ao vivo gravando cancelado_em', async () => {
      const agendado = await inserirLote(pool, leiloeiro, { status: 'agendado' });
      const aoVivo = await inserirLote(pool, leiloeiro, comLances());
      const canceladoEm = new Date();

      for (const { id } of [agendado, aoVivo]) {
        await banco.transaction((tx) => cancelarLote(tx, id, canceladoEm));
        expect(await linha(id)).toMatchObject({ status: 'cancelado', cancelado_em: canceladoEm });
      }
    });

    it('recusa lote encerrado, cancelado ou inexistente', async () => {
      const encerrado = await inserirLote(pool, leiloeiro, { ...vencido(), status: 'encerrado' });
      const cancelado = await inserirLote(pool, leiloeiro, { status: 'cancelado' });

      for (const id of [encerrado.id, cancelado.id, ID_INEXISTENTE]) {
        await expect(
          banco.transaction((tx) => cancelarLote(tx, id, new Date())),
        ).rejects.toMatchObject({ name: 'ErroDeLote', codigo: 'ESTADO_INVALIDO' });
      }
      expect(await linha(encerrado.id)).toMatchObject({ status: 'encerrado', cancelado_em: null });
    });
  });
});
