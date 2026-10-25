// Validação contra o eventbus/socketio/asyncapi.yaml (0.3.0) com Ajv 2020-12: o ack de
// `entrar_lote` (schema AckEntrarLote) e os payloads dos eventos servidor → cliente. O documento
// inteiro entra com um $id próprio; os "#/..." internos resolvem a partir dele.
import { readFileSync } from 'node:fs';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const CAMINHO = new URL('../../../../../eventbus/socketio/asyncapi.yaml', import.meta.url);
const ID = 'urn:leilao:asyncapi';

const documento = parse(readFileSync(CAMINHO, 'utf8')) as Record<string, unknown>;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema({ $id: ID, ...documento });

const cache = new Map<string, ValidateFunction>();

function validar(ponteiro: string, valor: unknown): void {
  let funcao = cache.get(ponteiro);
  if (funcao === undefined) {
    funcao = ajv.compile({ $ref: `${ID}${ponteiro}` });
    cache.set(ponteiro, funcao);
  }
  if (!funcao(valor)) {
    const erros = (funcao.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''} ${JSON.stringify(e.params)}`)
      .join('; ');
    throw new Error(`asyncapi: ${ponteiro} fora do contrato: ${erros}`);
  }
}

export function versaoDoAsyncapi(): unknown {
  return (documento['info'] as Record<string, unknown> | undefined)?.['version'];
}

/** Lança com o motivo se o ack não cumpre `AckEntrarLote`. */
export function validarAckDeEntrada(ack: unknown): void {
  validar('#/components/schemas/AckEntrarLote', ack);
}

/** Lança com o motivo se o payload não cumpre a mensagem `evento` do asyncapi. */
export function validarEvento(evento: string, payload: unknown): void {
  validar(`#/components/messages/${evento}/payload`, payload);
}
