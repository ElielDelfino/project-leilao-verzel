// Rota painelCancelarLote do openapi.yaml (specs/006 RF-04, specs/010 §Cancelamento). CSRF (403),
// sessão (401) e papel (403 PAPEL_NAO_PERMITIDO) vêm do guard global de identidade, antes do
// caso de uso; sem corpo: nenhum valor vem do cliente.
import { Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { Papel, UsuarioAtual } from '../../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../../common/envelope.js';
import { ServicoDeCancelamento } from './servico-de-cancelamento.js';

@Papel('leiloeiro')
@Controller('painel')
export class CancelamentoController {
  constructor(
    @Inject(ServicoDeCancelamento) private readonly cancelamento: ServicoDeCancelamento,
  ) {}

  @Post('lotes/:id/cancelamento')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @Param('id') loteId: string,
  ): Promise<RespostaDeSucesso<SchemasApi['Lote']>> {
    return sucesso(await this.cancelamento.cancelar(sessao.id, loteId));
  }
}
