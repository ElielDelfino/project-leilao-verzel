// Rotas da tag comprovantes do openapi.yaml (comprovanteObter e meArrematesListar; specs/011).
// O comprovante é público; /me/arremates é só de licitante (o guard global dá 401 e 403).
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { Papel, Publico, UsuarioAtual } from '../../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../../common/envelope.js';
import { PipeDaPagina } from './esquemas.js';
import { ServicoDeComprovantes } from './servico-de-comprovantes.js';

interface RespostaComMeta<T> extends RespostaDeSucesso<T> {
  readonly meta: SchemasApi['MetaPaginacao'];
}

@Controller()
export class ComprovantesController {
  constructor(
    @Inject(ServicoDeComprovantes) private readonly comprovantes: ServicoDeComprovantes,
  ) {}

  @Publico()
  @Get('comprovantes/:codigo')
  async obter(
    @Param('codigo') codigo: string,
  ): Promise<RespostaDeSucesso<SchemasApi['Comprovante']>> {
    return sucesso(await this.comprovantes.porCodigo(codigo));
  }

  @Papel('licitante')
  @Get('me/arremates')
  async meusArremates(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @Query('pagina', new PipeDaPagina()) pagina: number,
  ): Promise<RespostaComMeta<SchemasApi['Arremate'][]>> {
    const { dados, meta } = await this.comprovantes.doUsuario(sessao.id, pagina);
    return { ...sucesso([...dados]), meta };
  }
}
