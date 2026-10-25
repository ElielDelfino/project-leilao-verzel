// Rotas das tags catalogo e imagens do openapi.yaml (specs/005 §Interfaces e contratos). Sessão
// e papel vêm do guard global de identidade; a validação, dos pipes Zod.
import { Controller, Get, Headers, HttpStatus, Inject, Param, Query, Res } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import type { FastifyReply } from 'fastify';

import { Papel, Publico } from '../../common/auth/metadados.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { esquemaDaPaginaDaBusca, esquemaDoQ, PipeDoCampo } from './esquemas.js';
import { ServicoDeCatalogo } from './servico-de-catalogo.js';

/** A imagem do snapshot nunca muda (specs/005 §Imagem do snapshot). */
export const CACHE_CONTROL_DA_IMAGEM = 'public, max-age=31536000, immutable';

interface RespostaDaBusca extends RespostaDeSucesso<SchemasApi['CartaDaBusca'][]> {
  readonly meta: SchemasApi['MetaPaginacao'];
}

/** ETag forte do SHA-256: hexadecimal minúsculo entre aspas. */
export function etagDoSha256(sha256: Buffer): string {
  return `"${sha256.toString('hex')}"`;
}

/**
 * `If-None-Match` casa com o ETag: valor exato, `W/"..."` (comparação fraca, RFC 9110 §13.1.2),
 * lista separada por vírgula ou `*`.
 */
export function casaComEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  return ifNoneMatch
    .split(',')
    .map((v) => v.trim())
    .some((v) => v === '*' || v === etag || v === `W/${etag}`);
}

@Controller()
export class CatalogoController {
  constructor(@Inject(ServicoDeCatalogo) private readonly catalogo: ServicoDeCatalogo) {}

  @Papel('leiloeiro')
  @Get('catalogo/cartas')
  async buscar(
    @Query('q', new PipeDoCampo(esquemaDoQ, 'q')) q: string,
    @Query('pagina', new PipeDoCampo(esquemaDaPaginaDaBusca, 'pagina')) pagina: number,
  ): Promise<RespostaDaBusca> {
    const { dados, meta } = await this.catalogo.buscarCartas(q, pagina);
    return { ...sucesso([...dados]), meta };
  }

  /** Bytes sem envelope; 304 com o mesmo ETag e Cache-Control (specs/005). */
  @Publico()
  @Get('imagens/:snapshotId')
  async imagem(
    @Param('snapshotId') snapshotId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() resposta: FastifyReply,
  ): Promise<void> {
    const { imagem, imagemMime, imagemSha256 } = await this.catalogo.obterImagem(snapshotId);
    const etag = etagDoSha256(imagemSha256);
    resposta
      .header('cache-control', CACHE_CONTROL_DA_IMAGEM)
      .header('etag', etag)
      .header('x-content-type-options', 'nosniff');
    if (casaComEtag(ifNoneMatch, etag)) {
      await resposta.status(HttpStatus.NOT_MODIFIED).send();
      return;
    }
    await resposta.status(HttpStatus.OK).header('content-type', imagemMime).send(imagem);
  }
}
