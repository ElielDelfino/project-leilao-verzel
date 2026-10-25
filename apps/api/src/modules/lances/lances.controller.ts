// Rota POST /api/lotes/{id}/lances (openapi.yaml: lancesAceitar; specs/007). CSRF e sessão vêm do
// guard global de identidade; a rota não usa @Papel (ADR 0031 D11): o caso de uso recusa o
// leiloeiro com LEILOEIRO_NAO_PODE_LANCAR antes de validar corpo e header.
import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { UsuarioAtual } from '../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { type ResultadoDoLance, ServicoDeLances } from './servico-de-lances.js';

const CABECALHO_DE_IDEMPOTENCIA = 'idempotency-key';

const lerChaveDeIdempotencia = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): unknown =>
    contexto.switchToHttp().getRequest<FastifyRequest>().headers[CABECALHO_DE_IDEMPOTENCIA],
);

/** Valor cru do header Idempotency-Key; o caso de uso o valida depois do papel. */
function ChaveDeIdempotencia(): ParameterDecorator {
  return lerChaveDeIdempotencia();
}

@Controller('lotes')
export class LancesController {
  constructor(@Inject(ServicoDeLances) private readonly lances: ServicoDeLances) {}

  /** 201 no lance novo; 200 na repetição idempotente (mesma forma). */
  @Post(':id/lances')
  async aceitar(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @Param('id') loteId: string,
    @Body() corpo: unknown,
    @ChaveDeIdempotencia() chave: unknown,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<ResultadoDoLance['dados']>> {
    const { criado, dados } = await this.lances.aceitar(sessao, { loteId, corpo, chave });
    resposta.status(criado ? HttpStatus.CREATED : HttpStatus.OK);
    return sucesso(dados);
  }
}
