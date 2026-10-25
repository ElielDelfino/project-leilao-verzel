// Lint dos contratos (specs/013 §Contratos, tarefa 021): Redocly no OpenAPI e @asyncapi/parser no
// AsyncAPI. Sai com código ≠ 0 se qualquer um falhar. O AsyncAPI falha com diagnóstico de
// severidade error ou warning (info e hint passam). Sem telemetria: o Redocly e o scarf enviam
// analytics se não forem desligados.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Parser } from '@asyncapi/parser';

const raiz = join(import.meta.dirname, '..');
const ASYNCAPI = 'eventbus/socketio/asyncapi.yaml';
const SEVERIDADES_QUE_FALHAM = new Set([0, 1]); // 0 = error, 1 = warning
const NOMES = ['error', 'warning', 'info', 'hint'];

const env = {
  ...process.env,
  CI: 'true',
  REDOCLY_TELEMETRY: 'off',
  SCARF_ANALYTICS: 'false',
};

function lintOpenApi() {
  const redocly = join(raiz, 'node_modules/.bin/redocly');
  const r = spawnSync(redocly, ['lint', 'apps/api/openapi.yaml'], {
    cwd: raiz,
    env,
    stdio: 'inherit',
  });
  if (r.error) console.error(`redocly: ${r.error.message}`);
  return !r.error && r.status === 0;
}

async function lintAsyncApi() {
  const texto = await readFile(join(raiz, ASYNCAPI), 'utf8');
  const { diagnostics } = await new Parser().parse(texto, { source: join(raiz, ASYNCAPI) });
  const falhas = diagnostics.filter((d) => SEVERIDADES_QUE_FALHAM.has(d.severity));
  for (const d of diagnostics) {
    const caminho = d.path.length > 0 ? d.path.join('.') : '(raiz)';
    console.log(
      `${ASYNCAPI}: ${NOMES[d.severity] ?? d.severity} ${d.code} em ${caminho}: ${d.message}`,
    );
  }
  console.log(`${ASYNCAPI}: ${falhas.length === 0 ? 'válido' : `${falhas.length} falha(s)`}`);
  return falhas.length === 0;
}

const openapiOk = lintOpenApi();
const asyncapiOk = await lintAsyncApi().catch((erro) => {
  console.error(`asyncapi: ${erro.message}`);
  return false;
});
process.exit(openapiOk && asyncapiOk ? 0 : 1);
