import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';

import { type RespostaDeSucesso, sucesso } from '../common/envelope.js';
import { ErroApi } from '../common/erros/erro-api.js';
import { ServicoDeProntidao } from './prontidao.js';

interface EstadoDeSaude {
  readonly status: 'ok';
}

const OK: EstadoDeSaude = { status: 'ok' };

/** Health checks públicos (openapi.yaml: /api/health/live e /api/health/ready; ADR 0018). */
@Controller('health')
export class HealthController {
  constructor(@Inject(ServicoDeProntidao) private readonly prontidao: ServicoDeProntidao) {}

  /** Processo vivo: não consulta dependências. */
  @Get('live')
  live(): RespostaDeSucesso<EstadoDeSaude> {
    return sucesso(OK);
  }

  /** Pronto: Postgres e Redis respondendo; senão 503 INDISPONIVEL. */
  @Get('ready')
  async ready(): Promise<RespostaDeSucesso<EstadoDeSaude>> {
    const { pronto } = await this.prontidao.verificar();
    if (!pronto) {
      throw new ErroApi({
        codigo: 'INDISPONIVEL',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        mensagem: 'Serviço temporariamente indisponível. Tente novamente.',
      });
    }
    return sucesso(OK);
  }
}
