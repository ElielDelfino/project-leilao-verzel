// Rotas da tag lotes do openapi.yaml (specs/006 §Vitrine e §Detalhe). A vitrine é pública; o
// detalhe é público com sessão opcional (`suaPosicao`). Nenhuma das duas chama a Scryfall.
import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import type { FastifyReply } from 'fastify';

import { Publico, SessaoOpcional, UsuarioOpcional } from '../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { type FiltrosDaVitrine, PipeDaVitrine } from './esquemas-da-vitrine.js';
import { ServicoDeLotes } from './servico-de-lotes.js';

interface RespostaDaLista extends RespostaDeSucesso<SchemasApi['Lote'][]> {
  readonly meta: SchemasApi['MetaPaginacao'];
}

/** O detalhe varia por sessão: nem o navegador nem caches compartilhados guardam (200 e 404). */
const SEM_CACHE = 'private, no-store';

@Controller('lotes')
export class LotesController {
  constructor(@Inject(ServicoDeLotes) private readonly lotes: ServicoDeLotes) {}

  @Publico()
  @Get()
  async listar(@Query(new PipeDaVitrine()) filtros: FiltrosDaVitrine): Promise<RespostaDaLista> {
    const { dados, meta } = await this.lotes.listarDaVitrine(filtros);
    return { ...sucesso([...dados]), meta };
  }

  @SessaoOpcional()
  @Get(':id')
  async detalhar(
    @Param('id') id: string,
    @UsuarioOpcional() sessao: UsuarioDaSessao | undefined,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<SchemasApi['LoteDetalhe']>> {
    // Antes de qualquer throw: o filtro de exceções responde no mesmo reply e mantém o header.
    resposta.header('cache-control', SEM_CACHE);
    return sucesso(await this.lotes.detalhar(id, sessao?.id));
  }
}
