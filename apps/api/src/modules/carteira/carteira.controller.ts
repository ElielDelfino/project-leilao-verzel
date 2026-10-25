// Rotas da tag carteira do openapi.yaml (specs/004 §Interfaces e contratos). CSRF, sessão e papel
// vêm do guard global de identidade; a validação, dos pipes Zod (ADR 0027, D9).
import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpStatus,
  Inject,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Papel, UsuarioAtual } from '../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { PipeZod } from '../../common/validacao/pipe-zod.js';
import {
  type DadosDoDeposito,
  esquemaDaChaveDeIdempotencia,
  esquemaDaPagina,
  esquemaDoDeposito,
} from './esquemas.js';
import { type PaginaDoExtrato, ServicoDeCarteira } from './servico-de-carteira.js';

const CABECALHO_DE_IDEMPOTENCIA = 'idempotency-key';

/**
 * Valor cru do header Idempotency-Key. O @Headers do Nest não aceita pipes; um decorator de
 * parâmetro próprio aceita, e o PipeZod devolve 422 se faltar ou não for UUID.
 */
const ChaveDeIdempotencia = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): unknown =>
    contexto.switchToHttp().getRequest<FastifyRequest>().headers[CABECALHO_DE_IDEMPOTENCIA],
);

type DadosDoDepositoFeito = SchemasApi['RespostaDeposito']['dados'];

interface RespostaDoExtrato extends RespostaDeSucesso<PaginaDoExtrato['dados']> {
  readonly meta: PaginaDoExtrato['meta'];
}

@Controller('carteira')
export class CarteiraController {
  constructor(@Inject(ServicoDeCarteira) private readonly carteira: ServicoDeCarteira) {}

  @Get()
  async saldo(
    @UsuarioAtual() sessao: UsuarioDaSessao,
  ): Promise<RespostaDeSucesso<SchemasApi['Saldo']>> {
    return sucesso(await this.carteira.saldo(sessao.id));
  }

  /** 201 no lançamento novo; 200 na repetição da mesma chave e corpo (specs/004). */
  @Papel('licitante')
  @Post('depositos')
  async depositar(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @ChaveDeIdempotencia(new PipeZod(esquemaDaChaveDeIdempotencia)) chave: string,
    @Body(new PipeZod(esquemaDoDeposito)) dados: DadosDoDeposito,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<DadosDoDepositoFeito>> {
    const { criado, lancamento, saldo } = await this.carteira.depositar(
      sessao.id,
      chave,
      dados.valorCentavos,
    );
    resposta.status(criado ? HttpStatus.CREATED : HttpStatus.OK);
    return sucesso({ lancamento, saldo });
  }

  @Get('extrato')
  async extrato(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @Query('pagina', new PipeZod(esquemaDaPagina)) pagina: number,
  ): Promise<RespostaDoExtrato> {
    const { dados, meta } = await this.carteira.extrato(sessao.id, pagina);
    return { ...sucesso(dados), meta };
  }
}
