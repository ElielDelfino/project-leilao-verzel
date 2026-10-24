import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Module,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';

import { type RespostaDeSucesso, sucesso } from '../../src/common/envelope.js';
import { ErroApi } from '../../src/common/erros/erro-api.js';

export const MENSAGEM_INTERNA = 'falha interna com detalhe que não pode vazar';

/** Rotas só de teste para exercitar o filtro global de exceções. */
@Controller('teste-erros')
class ControladorDeErros {
  @Get('nao-tratado')
  naoTratado(): never {
    throw new Error(MENSAGEM_INTERNA);
  }

  @Get('nao-error')
  naoError(): never {
    // Simula uma biblioteca que lança algo que não é Error.
    throw MENSAGEM_INTERNA;
  }

  @Get('dominio')
  dominio(): never {
    throw new ErroApi({
      codigo: 'SALDO_INSUFICIENTE',
      status: 422,
      mensagem: 'Saldo disponível insuficiente.',
      detalhes: { faltamCentavos: 1500 },
    });
  }

  @Get('dominio-sem-detalhes')
  dominioSemDetalhes(): never {
    throw new ErroApi({ codigo: 'LOTE_ENCERRADO', status: 409, mensagem: 'Lote encerrado.' });
  }

  @Get('dominio-5xx')
  dominio5xx(): never {
    throw new ErroApi({ codigo: 'CATALOGO_INDISPONIVEL', status: 503, mensagem: 'Catálogo fora.' });
  }

  @Get('http-do-framework')
  httpDoFramework(): never {
    throw new BadRequestException(MENSAGEM_INTERNA);
  }

  /** Lança uma HttpException do Nest com o status pedido. */
  @Get('http/:status')
  http(@Param('status', ParseIntPipe) status: number): never {
    throw new HttpException(MENSAGEM_INTERNA, status);
  }

  /** Ecoa o corpo JSON: exercita os erros de parse do Fastify. */
  @Post('eco')
  eco(@Body() corpo: unknown): RespostaDeSucesso<unknown> {
    return sucesso(corpo);
  }
}

@Module({ controllers: [ControladorDeErros] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class ModuloDeErros {}
