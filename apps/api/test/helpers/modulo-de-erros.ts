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

/** Dado pessoal que um driver de banco põe em `detail`/`parameters`; nunca pode ir ao log. */
export const PII_DO_DRIVER = 'fulano@exemplo.com';

/** Erro como o de um cliente HTTP externo: tem `statusCode`, mas não é do framework. */
function erroDeBiblioteca(statusCode: number): Error {
  return Object.assign(new Error(MENSAGEM_INTERNA), { statusCode, code: 'ERR_UPSTREAM' });
}

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

  /** Erro de biblioteca externa com `statusCode` 4xx (ex.: 404 ou 429 de uma API upstream). */
  @Get('biblioteca/:status')
  biblioteca(@Param('status', ParseIntPipe) status: number): never {
    throw erroDeBiblioteca(status);
  }

  /** Valor lançado que não é Error, mas tem `statusCode` 4xx. */
  @Get('objeto-com-status')
  objetoComStatus(): never {
    // Simula uma biblioteca que lança um objeto com statusCode.
    throw { statusCode: 404, message: MENSAGEM_INTERNA };
  }

  /** Erro de driver de banco com PII em `detail` e `parameters` (como pg/postgres.js). */
  @Get('driver')
  driver(): never {
    throw Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: `Key (email)=(${PII_DO_DRIVER}) already exists.`,
      parameters: [PII_DO_DRIVER],
      params: [PII_DO_DRIVER],
    });
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
