// Rotas da tag auditoria do openapi.yaml (auditoriaDoLote e auditoriaChaves; specs/008 §Interfaces
// e contratos). As duas são públicas. A auditoria do lote nunca é cacheada, ao vivo ou selado: o
// veredito reflete o banco no momento da consulta (CacheControlNoStore). As chaves só crescem
// (append-only) e o navegador refaz a consulta ao ver um keyId novo: `public, max-age=60`.
import { Controller, Get, Inject, Logger, Param, Res } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import type { FastifyReply } from 'fastify';

import { Publico } from '../../common/auth/metadados.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { ErroApi } from '../../common/erros/erro-api.js';
import {
  LimiteDeTentativas,
  type RegraDoLimite,
} from '../../common/limite/limite-de-tentativas.js';
import { ServicoDeAuditoria } from './auditoria.js';
import { UUID_DO_LOTE } from './esquemas.js';

/** Valores exatos exigidos pelo openapi.yaml (CacheControlNoStore e CacheControlChaves). */
const SEM_CACHE = 'no-store';
const CACHE_DAS_CHAVES = 'public, max-age=60';

/**
 * Rate limit público (specs/011 §Rate limit). Até a tarefa 020 (`trustProxy`, F5): só o teto
 * global de 600 por minuto, sem limite fino por IP (atrás do Caddy todos teriam o mesmo IP).
 * Um contador só para as duas rotas (uma visita à página consome 2); com o prefixo do
 * LimiteDeTentativas a chave é `ratelimit:auditoria:global`.
 */
export const CHAVE_DO_LIMITE_DA_AUDITORIA = 'auditoria:global';
export const REGRA_DA_AUDITORIA: RegraDoLimite = Object.freeze({ limite: 600, janelaS: 60 });

/** Redis fora: no máximo um aviso por minuto por instância (specs/011 §Rate limit). */
const INTERVALO_DO_AVISO_MS = 60_000;

@Publico()
@Controller('auditoria')
export class AuditoriaController {
  readonly #logger = new Logger('Auditoria');
  #ultimoAvisoEm = Number.NEGATIVE_INFINITY;

  constructor(
    @Inject(ServicoDeAuditoria) private readonly auditoria: ServicoDeAuditoria,
    @Inject(LimiteDeTentativas) private readonly limite: LimiteDeTentativas,
  ) {}

  /**
   * Conta a requisição; o 429 sobe. Qualquer outra falha do contador (Redis fora) é falha ABERTA:
   * a requisição passa sem contar. O aviso traz só o nome do contador: nem IP nem o erro (cuja
   * mensagem pode carregar o endereço do Redis).
   */
  async #consumirLimite(): Promise<void> {
    try {
      await this.limite.consumir(CHAVE_DO_LIMITE_DA_AUDITORIA, REGRA_DA_AUDITORIA);
    } catch (erro: unknown) {
      if (erro instanceof ErroApi) throw erro;
      const agora = Date.now();
      if (agora - this.#ultimoAvisoEm >= INTERVALO_DO_AVISO_MS) {
        this.#ultimoAvisoEm = agora;
        this.#logger.warn(
          `rate limit da auditoria indisponível (contador ${CHAVE_DO_LIMITE_DA_AUDITORIA}); requisição liberada`,
        );
      }
    }
  }

  @Get('lotes/:id')
  async doLote(
    @Param('id') loteId: string,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<SchemasApi['Auditoria']>> {
    // Antes de qualquer throw: o filtro de exceções responde no mesmo reply e mantém o header.
    resposta.header('cache-control', SEM_CACHE);
    // Id que não é UUID é 404 idêntico (o serviço o recusa) e não consome o contador; o bem
    // formado conta antes de qualquer consulta ao banco (specs/011 §Rate limit).
    if (UUID_DO_LOTE.test(loteId)) await this.#consumirLimite();
    return sucesso(await this.auditoria.auditoriaDoLote(loteId));
  }

  @Get('chaves')
  async chaves(
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<SchemasApi['ChavePublica'][]>> {
    // O 429 e o 503 não podem ficar em cache compartilhado; só o 200 troca para o cache público.
    resposta.header('cache-control', SEM_CACHE);
    await this.#consumirLimite();
    const chaves = await this.auditoria.chavesPublicadas();
    // Só no sucesso: um erro não deve ficar 60 s em cache compartilhado.
    resposta.header('cache-control', CACHE_DAS_CHAVES);
    return sucesso(chaves);
  }
}
