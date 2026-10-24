import { BadRequestException, Controller, Get, Module } from '@nestjs/common';

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

  @Get('http-do-framework')
  httpDoFramework(): never {
    throw new BadRequestException(MENSAGEM_INTERNA);
  }
}

@Module({ controllers: [ControladorDeErros] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class ModuloDeErros {}
