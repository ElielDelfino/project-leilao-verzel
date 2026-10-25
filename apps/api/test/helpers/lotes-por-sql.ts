// Fixtures por SQL para os testes de integração de lotes (tarefa 062): usuários, snapshots mínimos e
// lotes gravados direto no Postgres, sem passar pela API nem pela Scryfall.
import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { emailNovo } from '../modules/identidade/ambiente.js';

export type ValorDeColuna = string | number | null;

export interface ContaPorSql {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
}

export interface LotePorSql {
  readonly id: string;
  readonly snapshotId: string;
}

const HORA_MS = 60 * 60 * 1000;
const NOME_DO_SNAPSHOT = 'Carta do Snapshot';

export const iso = (ms: number): string => new Date(ms).toISOString();

export async function inserirUsuario(
  pool: pg.Pool,
  papel: 'leiloeiro' | 'licitante',
): Promise<ContaPorSql> {
  const nome = `Pessoa Secreta ${randomUUID().slice(0, 8)}`;
  const email = emailNovo();
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (nome, email, senha_hash, papel) values ($1, $2, $3, $4) returning id`,
    [nome, email, 'hash-que-nao-e-usado', papel],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert em users não devolveu o id');
  return { id, nome, email };
}

/** Snapshot mínimo e lote; padrão: ao vivo, R$ 1,00, common, começou há 1 h e termina em 1 h. */
export async function inserirLote(
  pool: pg.Pool,
  leiloeiroId: string,
  extra: Readonly<Record<string, ValorDeColuna>> = {},
): Promise<LotePorSql> {
  const { rows: snap } = await pool.query<{ id: string }>(
    `insert into card_snapshots
       (scryfall_id, nome, colecao, raridade, tipo, texto_oracle, artista, dados, imagem,
        imagem_mime, imagem_sha256)
     values ($1, $2, 'Coleção', 'common', 'Instant', 'Causa 3 de dano.', null, '{}'::jsonb,
             '\\x00'::bytea, 'image/png', decode(repeat('00', 32), 'hex'))
     returning id`,
    [randomUUID(), NOME_DO_SNAPSHOT],
  );
  const snapshotId = snap[0]?.id;
  if (snapshotId === undefined) throw new Error('insert em card_snapshots não devolveu o id');
  const agora = Date.now();
  const fim = typeof extra['fim_em'] === 'string' ? extra['fim_em'] : iso(agora + HORA_MS);
  const colunas: Record<string, ValorDeColuna> = {
    leiloeiro_id: leiloeiroId,
    snapshot_id: snapshotId,
    carta_nome: 'Carta Comum',
    raridade: 'common',
    titulo: 'Lote de teste',
    lance_inicial_centavos: 100,
    incremento_minimo_centavos: 100,
    inicio_em: iso(agora - HORA_MS),
    fim_em: fim,
    fim_original_em: fim,
    status: 'ao_vivo',
    ...extra,
  };
  const nomes = Object.keys(colunas);
  const { rows } = await pool.query<{ id: string }>(
    `insert into lots (${nomes.join(', ')})
     values (${nomes.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(colunas),
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert em lots não devolveu o id');
  return { id, snapshotId };
}

/** Apaga lotes (e seus snapshots) ligados aos usuários, depois os usuários. */
export async function apagarLotesEUsuarios(
  pool: pg.Pool,
  usuarios: readonly string[],
): Promise<void> {
  const { rows } = await pool.query<{ snapshot_id: string }>(
    `delete from lots
      where leiloeiro_id = any($1::uuid[]) or lider_id = any($1::uuid[])
         or vencedor_id = any($1::uuid[])
      returning snapshot_id`,
    [usuarios],
  );
  await pool.query('delete from card_snapshots where id = any($1::uuid[])', [
    rows.map((r) => r.snapshot_id),
  ]);
  await pool.query('delete from users where id = any($1::uuid[])', [usuarios]);
}
