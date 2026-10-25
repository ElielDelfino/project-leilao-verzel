// Rotas da tag auditoria do openapi.yaml (auditoriaDoLote e auditoriaChaves; specs/008 §Interfaces
// e contratos). As duas são públicas. A auditoria do lote nunca é cacheada, ao vivo ou selado: o
// veredito reflete o banco no momento da consulta (CacheControlNoStore). As chaves só crescem
// (append-only) e o navegador refaz a consulta ao ver um keyId novo: `public, max-age=60`.
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import type { FastifyReply } from 'fastify';

import { Publico } from '../../common/auth/metadados.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { ServicoDeAuditoria } from './auditoria.js';

/** Valores exatos exigidos pelo openapi.yaml (CacheControlNoStore e CacheControlChaves). */
const SEM_CACHE = 'no-store';
const CACHE_DAS_CHAVES = 'public, max-age=60';

@Publico()
@Controller('auditoria')
export class AuditoriaController {
  constructor(@Inject(ServicoDeAuditoria) private readonly auditoria: ServicoDeAuditoria) {}

  @Get('lotes/:id')
  async doLote(
    @Param('id') loteId: string,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<SchemasApi['Auditoria']>> {
    // Antes de qualquer throw: o filtro de exceções responde no mesmo reply e mantém o header.
    resposta.header('cache-control', SEM_CACHE);
    return sucesso(await this.auditoria.auditoriaDoLote(loteId));
  }

  @Get('chaves')
  async chaves(
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<SchemasApi['ChavePublica'][]>> {
    const chaves = await this.auditoria.chavesPublicadas();
    // Só no sucesso: um erro não deve ficar 60 s em cache compartilhado.
    resposta.header('cache-control', CACHE_DAS_CHAVES);
    return sucesso(chaves);
  }
}
