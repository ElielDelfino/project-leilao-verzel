// Integração (Postgres real): `selar` confere o lote travado contra a cadeia antes de gravar
// (tarefa 112; specs/008, achado da 078). Recusa com erro de domínio e não grava selo quando o
// lote não é o do selo, está no status errado ou diverge da cadeia; selo repetido → SELO_JA_GRAVADO.
import { randomBytes, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarSegredosDaApi } from '../../../../src/config/env.js';
import { type BancoVerificavel, criarBanco } from '../../../../src/db/banco.js';
import {
  CadeiaDeLances,
  ErroDeSelo,
  type LoteTravado,
  type NovoSelo,
} from '../../../../src/modules/lances/index.js';
import { ServicoDeChaves } from '../../../../src/modules/lances/chaves.js';
import { agora } from '../../../../src/modules/lotes/index.js';
import { ambienteDeTeste } from '../../../db/ambiente-de-teste.js';
import { ENV_DE_TESTE } from '../../../helpers/app-de-teste.js';
import { inserirLote, inserirUsuario } from '../../../helpers/lotes-por-sql.js';

const BANCO = ambienteDeTeste(process.env);
/** A máquina roda muitos arquivos em paralelo contra o mesmo Postgres. */
const TIMEOUT_LONGO_MS = 90_000;

interface LoteComLances {
  readonly loteId: string;
  /** Estado coerente com a cadeia, como `lots` estaria sob o FOR UPDATE do encerramento. */
  readonly coerente: LoteTravado;
  readonly ultimoLanceId: string;
}

describe.skipIf(!BANCO.disponivel)('selar confere o lote travado (Postgres real)', () => {
  let banco: BancoVerificavel;
  let pool: pg.Pool;
  let cadeia: CadeiaDeLances;

  beforeAll(async () => {
    banco = criarBanco({ conexao: BANCO.conexao(), aoErroOcioso: () => undefined });
    pool = new pg.Pool(BANCO.conexao());
    const env = {
      ...ENV_DE_TESTE,
      segredos: criarSegredosDaApi({
        chaveJwt: new Uint8Array(randomBytes(32)),
        chavePseudonimo: new Uint8Array(randomBytes(32)),
        sementeEd25519: new Uint8Array(randomBytes(32)),
      }),
    };
    const chaves = new ServicoDeChaves(env, banco);
    await chaves.registrar();
    cadeia = new CadeiaDeLances(chaves);
  }, TIMEOUT_LONGO_MS);

  afterAll(async () => {
    await pool.end();
    await banco.encerrar();
  });

  async function novoLote(): Promise<string> {
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    return (await inserirLote(pool, leiloeiro.id)).id;
  }

  /** Lote com dois lances (o segundo de `liderId`), anexados com o lote travado. */
  async function loteComLances(): Promise<LoteComLances> {
    const loteId = await novoLote();
    const ids: string[] = [];
    const liderId = (await inserirUsuario(pool, 'licitante')).id;
    for (const [quem, valor] of [
      [(await inserirUsuario(pool, 'licitante')).id, 1_500],
      [liderId, 2_000],
    ] as const) {
      const lance = await banco.transaction(async (tx) => {
        await tx.execute(sql`select id from lots where id = ${loteId} for update`);
        return cadeia.anexar(tx, {
          loteId,
          licitanteId: quem,
          valorCentavos: valor,
          criadoEm: await agora(tx),
          idempotencyKey: randomUUID(),
        });
      });
      ids.push(lance.id);
    }
    const coerente: LoteTravado = {
      id: loteId,
      status: 'ao_vivo',
      totalLances: 2,
      lanceAtualCentavos: 2_000,
      liderId,
    };
    return { loteId, coerente, ultimoLanceId: ids[1] ?? '' };
  }

  function selar(novo: Omit<NovoSelo, 'seladoEm'>): Promise<unknown> {
    return banco.transaction(async (tx) =>
      cadeia.selar(tx, { ...novo, seladoEm: await agora(tx) }),
    );
  }

  async function selosDoLote(loteId: string): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      'select count(*)::text as n from lot_seals where lote_id = $1',
      [loteId],
    );
    return Number(rows[0]?.n);
  }

  async function esperarRecusa(promessa: Promise<unknown>, codigo: string): Promise<void> {
    const erro: unknown = await promessa.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroDeSelo);
    expect(erro).toMatchObject({ codigo });
  }

  it(
    'sela o lote coerente e devolve o id do último lance',
    async () => {
      const { loteId, coerente, ultimoLanceId } = await loteComLances();

      const selo = await selar({ loteId, status: 'encerrado', lote: coerente });

      expect(selo).toMatchObject({ ultimoLanceId, totalLances: 2, valorArremateCentavos: 2_000 });
      expect(await selosDoLote(loteId)).toBe(1);
    },
    TIMEOUT_LONGO_MS,
  );

  it.each<[string, (l: LoteTravado) => LoteTravado]>([
    ['totalLances diverge da cadeia (lote defasado)', (l) => ({ ...l, totalLances: 1 })],
    ['totalLances à frente da cadeia', (l) => ({ ...l, totalLances: 3 })],
    ['lanceAtualCentavos diverge do último lance', (l) => ({ ...l, lanceAtualCentavos: 1_500 })],
    ['líder não é o autor do último lance', (l) => ({ ...l, liderId: randomUUID() })],
    ['líder nulo com lances', (l) => ({ ...l, liderId: null })],
    ['id do lote não é o do selo', (l) => ({ ...l, id: randomUUID() })],
    ['encerrado sobre lote agendado', (l) => ({ ...l, status: 'agendado' })],
    ['encerrado sobre lote já encerrado', (l) => ({ ...l, status: 'encerrado' })],
    ['encerrado sobre lote cancelado', (l) => ({ ...l, status: 'cancelado' })],
  ])(
    'recusa com LOTE_DIVERGENTE e não grava selo: %s',
    async (_nome, mudar) => {
      const { loteId, coerente } = await loteComLances();

      await esperarRecusa(
        selar({ loteId, status: 'encerrado', lote: mudar(coerente) }),
        'LOTE_DIVERGENTE',
      );

      expect(await selosDoLote(loteId)).toBe(0);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'recusa lote sem lances com lance atual ou líder preenchidos',
    async () => {
      const loteId = await novoLote();
      const vazio: LoteTravado = {
        id: loteId,
        status: 'ao_vivo',
        totalLances: 0,
        lanceAtualCentavos: null,
        liderId: null,
      };

      await esperarRecusa(
        selar({ loteId, status: 'encerrado', lote: { ...vazio, lanceAtualCentavos: 1_000 } }),
        'LOTE_DIVERGENTE',
      );
      await esperarRecusa(
        selar({ loteId, status: 'encerrado', lote: { ...vazio, liderId: randomUUID() } }),
        'LOTE_DIVERGENTE',
      );
      expect(await selosDoLote(loteId)).toBe(0);
      // O mesmo lote, coerente, sela sem vencedor e sem último lance.
      expect(await selar({ loteId, status: 'encerrado', lote: vazio })).toMatchObject({
        totalLances: 0,
        vencedorPseudonimo: null,
        ultimoLanceId: null,
      });
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'selo repetido vira SELO_JA_GRAVADO e o primeiro selo continua único',
    async () => {
      const { loteId, coerente } = await loteComLances();
      await selar({ loteId, status: 'encerrado', lote: coerente });

      await esperarRecusa(
        selar({ loteId, status: 'encerrado', lote: coerente }),
        'SELO_JA_GRAVADO',
      );
      await esperarRecusa(
        selar({ loteId, status: 'cancelado', lote: coerente }),
        'SELO_JA_GRAVADO',
      );

      expect(await selosDoLote(loteId)).toBe(1);
    },
    TIMEOUT_LONGO_MS,
  );
});
