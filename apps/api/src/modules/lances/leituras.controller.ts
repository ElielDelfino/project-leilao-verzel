// Rotas de leitura da tag lances do openapi.yaml (lancesListarDoLote e meLancesListar; specs/007
// §Interfaces e contratos). O histórico é público; /me/lances é só de licitante (o guard global
// de identidade devolve 401 sem sessão e 403 PAPEL_NAO_PERMITIDO ao leiloeiro). As duas respostas
// refletem o banco no momento da consulta: Cache-Control `no-store`.
import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import type { FastifyReply } from 'fastify';

import { Papel, Publico, UsuarioAtual } from '../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { PipeDaPaginaDeLances } from './esquemas.js';
import { LeiturasDeLances } from './leituras-de-lances.js';
import type { LancePublico } from './regras.js';

/** Valor exato exigido pelo openapi.yaml (CacheControlNoStore). */
const SEM_CACHE = 'no-store';

interface RespostaComMeta<T> extends RespostaDeSucesso<T> {
  readonly meta: SchemasApi['MetaPaginacao'];
}

@Controller('lotes')
export class HistoricoDeLancesController {
  constructor(@Inject(LeiturasDeLances) private readonly leituras: LeiturasDeLances) {}

  @Publico()
  @Get(':id/lances')
  async listar(
    @Param('id') loteId: string,
    @Query('pagina', new PipeDaPaginaDeLances()) pagina: number,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaComMeta<LancePublico[]>> {
    // Antes de qualquer throw: o filtro de exceções responde no mesmo reply e mantém o header.
    resposta.header('cache-control', SEM_CACHE);
    const { dados, meta } = await this.leituras.historicoDoLote(loteId, pagina);
    return { ...sucesso([...dados]), meta };
  }
}

@Papel('licitante')
@Controller('me')
export class MeusLancesController {
  constructor(@Inject(LeiturasDeLances) private readonly leituras: LeiturasDeLances) {}

  @Get('lances')
  async listar(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @Query('pagina', new PipeDaPaginaDeLances()) pagina: number,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaComMeta<SchemasApi['LanceDoUsuario'][]>> {
    resposta.header('cache-control', SEM_CACHE);
    const { dados, meta } = await this.leituras.lancesDoUsuario(sessao.id, pagina);
    return { ...sucesso([...dados]), meta };
  }
}
