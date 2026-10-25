// Integração (Postgres real): interface pública de lotes para o módulo lances (tarefa 075).
// travarLote (FOR UPDATE), registrarLance (lance atual, líder, contador e extensão sem recuar o
// fim), obterResumos e agora (clock_timestamp). Fixtures por SQL; tudo apagado no afterAll.
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type BancoVerificavel, criarBanco } from '../../../src/db/banco.js';
import {
  agora,
  obterResumos,
  registrarLance,
  travarLote,
} from '../../../src/modules/lotes/index.js';
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
/** Tempo que a segunda transação fica esperando o lock antes de a primeira terminar. */
const ESPERA_DO_LOCK_MS = 300;

const esperar = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe.skipIf(!BANCO.disponivel)('lotes: interface para lances (Postgres real)', () => {
  let banco: BancoVerificavel;
  let pool: pg.Pool;
  const usuarios: string[] = [];
  let leiloeiro = '';
  let licitante = '';
  let outroLicitante = '';

  beforeAll(async () => {
    banco = criarBanco({ conexao: BANCO.conexao(), aoErroOcioso: () => undefined });
    pool = new pg.Pool(BANCO.conexao());
    leiloeiro = (await inserirUsuario(pool, 'leiloeiro')).id;
    licitante = (await inserirUsuario(pool, 'licitante')).id;
    outroLicitante = (await inserirUsuario(pool, 'licitante')).id;
    usuarios.push(leiloeiro, licitante, outroLicitante);
  });

  afterAll(async () => {
    await apagarLotesEUsuarios(pool, usuarios);
    await pool.end();
    await banco.encerrar();
  });

  describe('travarLote', () => {
    it('devolve a linha do lote com as colunas que o lance precisa', async () => {
      const fim = iso(Date.now() + HORA);
      const { id } = await inserirLote(pool, leiloeiro, {
        lance_inicial_centavos: 500,
        incremento_minimo_centavos: 200,
        fim_em: fim,
      });

      const linha = await banco.transaction((tx) => travarLote(tx, id));

      expect(linha).toEqual({
        id,
        leiloeiroId: leiloeiro,
        status: 'ao_vivo',
        inicioEm: expect.any(Date) as Date,
        fimEm: new Date(fim),
        fimOriginalEm: new Date(fim),
        lanceInicialCentavos: 500,
        incrementoMinimoCentavos: 200,
        lanceAtualCentavos: null,
        liderId: null,
        totalLances: 0,
      });
    });

    it('devolve null para lote inexistente', async () => {
      await expect(banco.transaction((tx) => travarLote(tx, ID_INEXISTENTE))).resolves.toBeNull();
    });

    it('bloqueia uma segunda transação até a primeira terminar', async () => {
      const { id } = await inserirLote(pool, leiloeiro);
      let liberar: () => void = () => undefined;
      const primeiraTravou = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      let fimDaPrimeira = 0;

      const primeira = banco.transaction(async (tx) => {
        await travarLote(tx, id);
        liberar();
        await esperar(ESPERA_DO_LOCK_MS);
        await registrarLance(tx, id, { valorCentavos: 100, liderId: licitante });
        fimDaPrimeira = performance.now();
      });
      await primeiraTravou;
      const segunda = banco.transaction(async (tx) => {
        const linha = await travarLote(tx, id);
        return { linha, em: performance.now() };
      });

      await primeira;
      const { linha, em } = await segunda;
      expect(em).toBeGreaterThanOrEqual(fimDaPrimeira);
      expect(linha).toMatchObject({ lanceAtualCentavos: 100, liderId: licitante, totalLances: 1 });
    });
  });

  describe('registrarLance', () => {
    it('atualiza lance atual, líder e contador sem mexer no fim', async () => {
      const fim = iso(Date.now() + HORA);
      const { id } = await inserirLote(pool, leiloeiro, { fim_em: fim });

      const resultado = await banco.transaction(async (tx) => {
        await travarLote(tx, id);
        await registrarLance(tx, id, { valorCentavos: 100, liderId: licitante });
        return registrarLance(tx, id, { valorCentavos: 300, liderId: outroLicitante });
      });

      expect(resultado).toEqual({
        lanceAtualCentavos: 300,
        liderId: outroLicitante,
        totalLances: 2,
        fimEm: new Date(fim),
      });
    });

    it('estende o fim quando recebe novoFimEm (anti-sniping)', async () => {
      const fim = Date.now() + MINUTO;
      const { id } = await inserirLote(pool, leiloeiro, { fim_em: iso(fim) });
      const novoFimEm = new Date(fim + 2 * MINUTO);

      const resultado = await banco.transaction((tx) =>
        registrarLance(tx, id, { valorCentavos: 100, liderId: licitante, novoFimEm }),
      );

      expect(resultado?.fimEm).toEqual(novoFimEm);
      const linha = await banco.transaction((tx) => travarLote(tx, id));
      expect(linha?.fimEm).toEqual(novoFimEm);
      expect(linha?.fimOriginalEm).toEqual(new Date(fim));
    });

    it('não recua o fim quando novoFimEm é anterior ao fim atual', async () => {
      const fim = iso(Date.now() + HORA);
      const { id } = await inserirLote(pool, leiloeiro, { fim_em: fim });

      const resultado = await banco.transaction((tx) =>
        registrarLance(tx, id, {
          valorCentavos: 100,
          liderId: licitante,
          novoFimEm: new Date(Date.now() + MINUTO),
        }),
      );

      expect(resultado?.fimEm).toEqual(new Date(fim));
    });

    it('devolve null para lote inexistente', async () => {
      await expect(
        banco.transaction((tx) =>
          registrarLance(tx, ID_INEXISTENTE, { valorCentavos: 100, liderId: licitante }),
        ),
      ).resolves.toBeNull();
    });
  });

  describe('obterResumos', () => {
    it('devolve lista vazia sem consultar quando não há ids', async () => {
      await expect(banco.consultar((db) => obterResumos(db, []))).resolves.toEqual([]);
    });

    it('devolve o resumo dos lotes existentes, com status derivado, e ignora os inexistentes', async () => {
      const aoVivo = await inserirLote(pool, leiloeiro, { titulo: 'Ao vivo' });
      const encerrado = await inserirLote(pool, leiloeiro, {
        titulo: 'Encerrado',
        inicio_em: iso(Date.now() - 2 * HORA),
        fim_em: iso(Date.now() - HORA),
      });
      await banco.transaction((tx) =>
        registrarLance(tx, aoVivo.id, { valorCentavos: 100, liderId: licitante }),
      );

      const resumos = await banco.consultar((db) =>
        obterResumos(db, [aoVivo.id, encerrado.id, ID_INEXISTENTE]),
      );

      const porId = new Map(resumos.map((r) => [r.id, r]));
      expect(resumos).toHaveLength(2);
      expect(porId.get(aoVivo.id)).toMatchObject({
        titulo: 'Ao vivo',
        status: 'ao_vivo',
        lanceAtualCentavos: 100,
        liderId: licitante,
        vencedorId: null,
        totalLances: 1,
        snapshotId: aoVivo.snapshotId,
      });
      expect(porId.get(encerrado.id)).toMatchObject({ titulo: 'Encerrado', status: 'encerrado' });
    });
  });

  describe('agora', () => {
    it('lê o relógio do Postgres, que avança dentro da mesma transação', async () => {
      const [antes, depois] = await banco.transaction(async (tx) => {
        const a = await agora(tx);
        await tx.execute(sql`select pg_sleep(0.01)`);
        return [a, await agora(tx)] as const;
      });

      expect(antes).toBeInstanceOf(Date);
      expect(depois.getTime()).toBeGreaterThan(antes.getTime());
    });
  });
});
