// Rotas só de teste para os guards e a ordem das verificações (specs/003 §Comportamento e §Ordem).
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { z } from 'zod';

import { Papel, Publico, UsuarioAtual } from '../../../src/common/auth/metadados.js';
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

@Module({ controllers: [ControladorDeGuardas] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class ModuloDeGuardas {}
