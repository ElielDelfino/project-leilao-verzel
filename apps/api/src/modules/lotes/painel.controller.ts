// Rotas da tag painel do openapi.yaml (specs/006 §Criação e §Painel), só para leiloeiro. CSRF,
// sessão e papel vêm do guard global de identidade; a validação, dos pipes desta pasta.
import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { Papel, UsuarioAtual } from '../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import {
  esquemaDaPaginaDoPainel,
  type NovoLoteValidado,
  PipeDaPaginaDoPainel,
  PipeDoNovoLote,
} from './esquemas.js';
import { ServicoDeLotes } from './servico-de-lotes.js';

interface RespostaDaLista extends RespostaDeSucesso<SchemasApi['Lote'][]> {
  readonly meta: SchemasApi['MetaPaginacao'];
}

@Papel('leiloeiro')
@Controller('painel')
export class PainelController {
  constructor(@Inject(ServicoDeLotes) private readonly lotes: ServicoDeLotes) {}

  /** 201 (padrão do POST no Nest) com o lote criado. */
  @Post('lotes')
  async criar(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @Body(new PipeDoNovoLote()) dados: NovoLoteValidado,
  ): Promise<RespostaDeSucesso<SchemasApi['Lote']>> {
    return sucesso(await this.lotes.criar(sessao.id, dados));
  }

  @Get('lotes')
  async listar(
    @UsuarioAtual() sessao: UsuarioDaSessao,
    @Query('pagina', new PipeDaPaginaDoPainel(esquemaDaPaginaDoPainel)) pagina: number,
  ): Promise<RespostaDaLista> {
    const { dados, meta } = await this.lotes.listarDoLeiloeiro(sessao.id, pagina);
    return { ...sucesso([...dados]), meta };
  }

  @Get('resumo')
  async resumo(
    @UsuarioAtual() sessao: UsuarioDaSessao,
  ): Promise<RespostaDeSucesso<SchemasApi['ResumoDoPainel']>> {
    return sucesso(await this.lotes.resumo(sessao.id));
  }
}
