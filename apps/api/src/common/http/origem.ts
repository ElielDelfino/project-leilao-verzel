// Origem das requisições que mudam estado (tarefa 020). SPA e API são a mesma origem pelo Caddy,
// então a API não envia `access-control-allow-*`: o navegador bloqueia a leitura cross-origin. Um
// POST/PUT/PATCH/DELETE com `Origin` diferente de WEB_ORIGIN é recusado antes de qualquer rota,
// como reforço do double-submit do CSRF (specs/003 §Ordem das verificações, etapa 1). Sem `Origin`
// (cliente que não é navegador) a requisição segue para o CSRF da rota.
import { HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

import { falha } from '../envelope.js';

const METODOS_QUE_MUDAM_ESTADO: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Mesmo texto da guarda de CSRF (modules/identidade/guarda.ts). */
const MENSAGEM = 'Token CSRF ausente ou inválido.';

export type HookDeOrigem = (
  requisicao: FastifyRequest,
  resposta: FastifyReply,
  continuar: HookHandlerDoneFunction,
) => void;

/**
 * Hook `onRequest` (estilo callback) que recusa a origem estranha com 403 CSRF_INVALIDO no
 * envelope. Ao responder ele não chama `continuar`, e a cadeia para ali.
 */
export function criarVerificacaoDeOrigem(origemPermitida: string): HookDeOrigem {
  return (requisicao, resposta, continuar) => {
    const { origin } = requisicao.headers;
    if (
      !METODOS_QUE_MUDAM_ESTADO.has(requisicao.method) ||
      origin === undefined ||
      origin === origemPermitida
    ) {
      continuar();
      return;
    }
    // Sem a origem no log: é texto do cliente.
    requisicao.log.warn(
      { status: HttpStatus.FORBIDDEN, codigo: 'CSRF_INVALIDO' },
      'origem recusada',
    );
    void resposta
      .code(HttpStatus.FORBIDDEN)
      .send(falha({ codigo: 'CSRF_INVALIDO', mensagem: MENSAGEM }));
  };
}
