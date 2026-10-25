// Acesso a `card_snapshots` (specs/005 §Dados). O papel da API só tem SELECT e INSERT na tabela
// (ADR 0026): o snapshot é imutável.
import { eq } from 'drizzle-orm';

import type { BancoDrizzle, Transacao } from '../../db/banco.js';
import type { MimeDeImagem } from './download-de-imagem.js';
import { cardSnapshots } from './schema.js';

export interface NovoSnapshot {
  readonly scryfallId: string;
  readonly nome: string;
  readonly colecao: string;
  readonly raridade: string;
  readonly tipo: string;
  readonly textoOracle: string | null;
  readonly artista: string | null;
  readonly dados: Readonly<Record<string, unknown>>;
  readonly imagem: Buffer;
  readonly imagemMime: MimeDeImagem;
  readonly imagemSha256: Buffer;
}

export interface LinhaDoSnapshot {
  readonly scryfallId: string;
  readonly nome: string;
  readonly colecao: string;
  readonly raridade: string;
  readonly tipo: string;
  readonly textoOracle: string | null;
  readonly artista: string | null;
}

export interface LinhaDaImagem {
  readonly imagem: Buffer;
  readonly imagemMime: string;
  readonly imagemSha256: Buffer;
}

export async function inserirSnapshot(tx: Transacao, novo: NovoSnapshot): Promise<string> {
  const [linha] = await tx.insert(cardSnapshots).values(novo).returning({ id: cardSnapshots.id });
  if (linha === undefined) throw new Error('insert em card_snapshots não devolveu o id');
  return linha.id;
}

export async function lerSnapshot(
  db: BancoDrizzle,
  snapshotId: string,
): Promise<LinhaDoSnapshot | undefined> {
  const [linha] = await db
    .select({
      scryfallId: cardSnapshots.scryfallId,
      nome: cardSnapshots.nome,
      colecao: cardSnapshots.colecao,
      raridade: cardSnapshots.raridade,
      tipo: cardSnapshots.tipo,
      textoOracle: cardSnapshots.textoOracle,
      artista: cardSnapshots.artista,
    })
    .from(cardSnapshots)
    .where(eq(cardSnapshots.id, snapshotId));
  return linha;
}

export async function lerImagem(
  db: BancoDrizzle,
  snapshotId: string,
): Promise<LinhaDaImagem | undefined> {
  const [linha] = await db
    .select({
      imagem: cardSnapshots.imagem,
      imagemMime: cardSnapshots.imagemMime,
      imagemSha256: cardSnapshots.imagemSha256,
    })
    .from(cardSnapshots)
    .where(eq(cardSnapshots.id, snapshotId));
  return linha;
}
