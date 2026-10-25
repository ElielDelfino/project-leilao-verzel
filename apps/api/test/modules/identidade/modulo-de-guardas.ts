// Rotas só de teste para os guards e a ordem das verificações (specs/003 §Comportamento e §Ordem).
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { z } from 'zod';

import {
  Papel,
  Publico,
  SessaoOpcional,
  UsuarioAtual,
  UsuarioOpcional,
} from '../../../src/common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../../src/common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../../src/common/envelope.js';
import { PipeZod } from '../../../src/common/validacao/pipe-zod.js';

const corpoDeTeste = z.strictObject({ valorCentavos: z.number().int().min(100) });

@Controller('teste-guardas')
class ControladorDeGuardas {
  @Publico()
  @Get('publica')
  publica(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }

  /** Como GET /api/lotes/{id}: pública, com `usuario` quando há sessão válida (task 053). */
  @SessaoOpcional()
  @Get('opcional')
  opcional(
    @UsuarioOpcional() usuario: UsuarioDaSessao | undefined,
  ): RespostaDeSucesso<{ usuario: UsuarioDaSessao | null }> {
    return sucesso({ usuario: usuario ?? null });
  }

  @SessaoOpcional()
  @Post('opcional')
  @HttpCode(200)
  opcionalPost(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }

  @Get('sessao')
  sessao(@UsuarioAtual() usuario: UsuarioDaSessao): RespostaDeSucesso<UsuarioDaSessao> {
    return sucesso(usuario);
  }

  @Papel('licitante')
  @Get('licitante')
  soLicitante(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }

  @Papel('leiloeiro')
  @Get('leiloeiro')
  soLeiloeiro(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }

  /** Como POST /api/carteira/depositos: licitante, CSRF e corpo validado. */
  @Papel('licitante')
  @Post('deposito')
  @HttpCode(201)
  deposito(
    @Body(new PipeZod(corpoDeTeste)) corpo: z.infer<typeof corpoDeTeste>,
  ): RespostaDeSucesso<typeof corpo> {
    return sucesso(corpo);
  }
}

/** Combinações proibidas com @SessaoOpcional (task 053): o guard tem de falhar fechado. */
@SessaoOpcional()
@Controller('teste-guardas/opcional-na-classe')
class ControladorOpcionalNaClasse {
  @Papel('leiloeiro')
  @Get('papel-no-metodo')
  papelNoMetodo(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }

  @Publico()
  @Get('publico-no-metodo')
  publicoNoMetodo(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }
}

@Papel('leiloeiro')
@Controller('teste-guardas/papel-na-classe')
class ControladorPapelNaClasse {
  @SessaoOpcional()
  @Get('opcional-no-metodo')
  opcionalNoMetodo(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }
}

@Publico()
@Controller('teste-guardas/publico-na-classe')
class ControladorPublicoNaClasse {
  @SessaoOpcional()
  @Get('opcional-no-metodo')
  opcionalNoMetodo(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }

  @SessaoOpcional()
  @Papel('leiloeiro')
  @Get('tudo-no-metodo')
  tudoNoMetodo(): RespostaDeSucesso<{ ok: true }> {
    return sucesso({ ok: true });
  }
}

@Module({
  controllers: [
    ControladorDeGuardas,
    ControladorOpcionalNaClasse,
    ControladorPapelNaClasse,
    ControladorPublicoNaClasse,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class ModuloDeGuardas {}
