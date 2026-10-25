// Regras do catálogo (specs/005): busca paginada em 25, snapshot em duas etapas (preparo com rede
// fora da transação; gravação só com o INSERT) e leitura do snapshot e da imagem, que nunca
// chamam a Scryfall (RNF-01).
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { ErroApi } from '../../common/erros/erro-api.js';
import { BANCO } from '../../config/banco.module.js';
import { ENV, type Env } from '../../config/env.js';
import type { BancoVerificavel, Transacao } from '../../db/banco.js';
import { lerCartaDoSnapshot } from './carta-do-snapshot.js';
import { baixarImagem, RecusaDaImagem } from './download-de-imagem.js';
import { CARTAS_POR_PAGINA } from './esquemas.js';
import {
  inserirSnapshot,
  type LinhaDaImagem,
  type LinhaDoSnapshot,
  lerImagem,
  lerSnapshot,
  type NovoSnapshot,
} from './repositorio.js';
import type { CartaDaBusca, ClienteScryfall } from './scryfall/cliente-scryfall.js';
import { campoInvalido, catalogoIndisponivel } from './scryfall/erros.js';
import { UUID } from './scryfall/projecao.js';
import { CLIENTE_SCRYFALL } from './scryfall/scryfall.provider.js';

/** Páginas nossas por página da Scryfall: 175 = 7 × 25 (specs/005 §Busca). */
const PAGINAS_POR_PAGINA_SCRYFALL = 7;
/** Só miniaturas deste prefixo chegam ao navegador (ADR 0029); outra origem vira `null`. */
const PREFIXO_DA_MINIATURA = 'https://cards.scryfall.io/';
/** Base padrão da Scryfall; outra origem em SCRYFALL_BASE_URL também serve imagens (teste). */
const BASE_PADRAO_DA_SCRYFALL = 'https://api.scryfall.com';

export interface PaginaDeCartas {
  readonly dados: readonly CartaDaBusca[];
  readonly meta: { readonly total: number; readonly pagina: number; readonly limite: number };
}

/** Carta e imagem já baixadas e conferidas, prontas para o INSERT (sem rede na transação). */
export type SnapshotPreparado = NovoSnapshot;

/** Campos do snapshot sem a imagem (Carta no openapi.yaml). */
export type CartaDoSnapshot = LinhaDoSnapshot;

export type ImagemDoSnapshot = LinhaDaImagem;

function naoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Recurso não encontrado.',
  });
}

function miniaturaSegura(carta: CartaDaBusca): CartaDaBusca {
  const url = carta.imagemUrl;
  return url !== null && url.startsWith(PREFIXO_DA_MINIATURA)
    ? carta
    : { ...carta, imagemUrl: null };
}

@Injectable()
export class ServicoDeCatalogo {
  readonly #logger = new Logger('Catalogo');
  readonly #origemExtra: string | undefined;

  constructor(
    @Inject(BANCO) private readonly banco: BancoVerificavel,
    @Inject(CLIENTE_SCRYFALL) private readonly scryfall: ClienteScryfall,
    @Inject(ENV) private readonly env: Env,
  ) {
    const base = env.scryfall.baseUrl;
    this.#origemExtra = base === BASE_PADRAO_DA_SCRYFALL ? undefined : new URL(base).origin;
  }

  /** `pagina` (25 cartas) sobre a página Scryfall `ceil(pagina / 7)` (specs/005 §Busca). */
  async buscarCartas(q: string, pagina: number): Promise<PaginaDeCartas> {
    const paginaScryfall = Math.ceil(pagina / PAGINAS_POR_PAGINA_SCRYFALL);
    const inicio = ((pagina - 1) % PAGINAS_POR_PAGINA_SCRYFALL) * CARTAS_POR_PAGINA;
    const { total, cartas } = await this.scryfall.buscar(q, paginaScryfall);
    return {
      dados: cartas.slice(inicio, inicio + CARTAS_POR_PAGINA).map(miniaturaSegura),
      meta: { total, pagina, limite: CARTAS_POR_PAGINA },
    };
  }

  /** Rede e Redis, sem `tx`: carta + imagem `normal` conferida (specs/005 §Snapshot). */
  async prepararSnapshot(scryfallId: string): Promise<SnapshotPreparado> {
    const carta = await this.scryfall.obterCarta(scryfallId);
    if (carta === null) throw campoInvalido('scryfallId');
    const lida = lerCartaDoSnapshot(carta);
    if (lida === undefined) throw catalogoIndisponivel();
    if (lida.urlDaImagem === null) throw campoInvalido('scryfallId');
    const imagem = await this.#baixar(lida.urlDaImagem);
    return {
      scryfallId: scryfallId.toLowerCase(),
      nome: lida.nome,
      colecao: lida.colecao,
      raridade: lida.raridade,
      tipo: lida.tipo,
      textoOracle: lida.textoOracle,
      artista: lida.artista,
      dados: carta,
      imagem: imagem.bytes,
      imagemMime: imagem.mime,
      imagemSha256: imagem.sha256,
    };
  }

  /** Só o INSERT, na transação de quem cria o lote. Devolve o `snapshotId`. */
  async gravarSnapshot(tx: Transacao, preparado: SnapshotPreparado): Promise<string> {
    return inserirSnapshot(tx, preparado);
  }

  /** Campos do snapshot sem a imagem; `null` se o id não existir ou não for UUID. */
  async obterSnapshot(snapshotId: string): Promise<CartaDoSnapshot | null> {
    if (!UUID.test(snapshotId)) return null;
    return (await this.banco.consultar((db) => lerSnapshot(db, snapshotId))) ?? null;
  }

  /** Bytes, tipo e SHA-256 da imagem; 404 NAO_ENCONTRADO se não existir ou não for UUID. */
  async obterImagem(snapshotId: string): Promise<ImagemDoSnapshot> {
    if (!UUID.test(snapshotId)) throw naoEncontrado();
    const imagem = await this.banco.consultar((db) => lerImagem(db, snapshotId));
    if (imagem === undefined) throw naoEncontrado();
    return imagem;
  }

  async #baixar(url: string): ReturnType<typeof baixarImagem> {
    try {
      return await baixarImagem(url, {
        userAgent: this.env.scryfall.userAgent,
        ...(this.#origemExtra === undefined ? {} : { origemExtra: this.#origemExtra }),
      });
    } catch (erro: unknown) {
      if (!(erro instanceof RecusaDaImagem)) throw erro;
      // Só o motivo: a URL e os bytes não vão para o log.
      this.#logger.warn(`imagem do snapshot recusada: ${erro.motivo}`);
      throw catalogoIndisponivel();
    }
  }
}
