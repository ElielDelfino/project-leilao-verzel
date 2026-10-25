// Gera packages/contracts/src/{gerado/,index.ts} a partir dos contratos (specs/001 §Contratos, tarefa 009).
// Uso: node scripts/contracts-gen.mjs [--check]
//   sem flag: (re)escreve os arquivos gerados;
//   --check: não escreve; sai com 1 se algum gerado estiver desatualizado (usado no CI).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import openapiTS, { astToString } from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';
import { parse } from 'yaml';

const RAIZ = resolve(process.env.CONTRACTS_RAIZ ?? join(import.meta.dirname, '..'));
const OPENAPI = join(RAIZ, 'apps/api/openapi.yaml');
const ASYNCAPI = join(RAIZ, 'eventbus/socketio/asyncapi.yaml');
const DESTINO = join(RAIZ, 'packages/contracts/src');
const CABECALHO =
  '// Arquivo gerado por `pnpm contracts:gen` a partir de {fonte}. Não edite à mão.\n';

const pascal = (nome) => nome.replace(/(^|_)([a-z])/g, (_, __, letra) => letra.toUpperCase());

async function gerarOpenApi() {
  const texto = await readFile(OPENAPI, 'utf8');
  const ast = await openapiTS(parse(texto));
  return CABECALHO.replace('{fonte}', 'apps/api/openapi.yaml') + astToString(ast);
}

// Os payloads do AsyncAPI são JSON Schema; embrulhados como components.schemas de um OpenAPI 3.1
// mínimo, os $ref '#/components/schemas/*' continuam válidos e o mesmo gerador produz os tipos.
async function gerarEventos() {
  const contrato = parse(await readFile(ASYNCAPI, 'utf8'));
  const mensagens = Object.values(contrato.components.messages);
  const schemas = { ...contrato.components.schemas };
  for (const mensagem of mensagens) {
    if (!mensagem.name) throw new Error('asyncapi.yaml: mensagem sem `name` (nome do evento)');
    schemas[pascal(mensagem.name)] = mensagem.payload;
  }
  const embrulho = {
    openapi: '3.1.0',
    info: { title: contrato.info.title, version: contrato.info.version },
    paths: {},
    components: { schemas },
  };
  const ast = await openapiTS(embrulho);
  const mapa = mensagens
    .map((m) => `  ${m.name}: components['schemas']['${pascal(m.name)}'];`)
    .join('\n');
  return (
    CABECALHO.replace('{fonte}', 'eventbus/socketio/asyncapi.yaml') +
    astToString(ast) +
    '\n/** Eventos servidor → cliente do namespace /leilao: nome do evento → payload. */\n' +
    `export interface EventosDoServidor {\n${mapa}\n}\n`
  );
}

// Interface pública do pacote: só tipos, reexportados dos gerados.
function gerarIndice() {
  return `// Arquivo gerado por \`pnpm contracts:gen\`. Não edite à mão.
// Interface pública de @leilao/contracts: só tipos, gerados dos contratos (specs/001 §Contratos).
import type { EventosDoServidor } from './gerado/eventos.js';
import type { components, operations, paths } from './gerado/openapi.js';

export type { EventosDoServidor };
export type RotasApi = paths;
export type OperacoesApi = operations;
export type SchemasApi = components['schemas'];

/** Mapa de eventos servidor → cliente no formato do Socket.IO (\`Server<_, ServidorParaCliente>\`). */
export type ServidorParaCliente = {
  [Evento in keyof EventosDoServidor]: (payload: EventosDoServidor[Evento]) => void;
};
`;
}

async function formatar(conteudo, caminho) {
  const config = (await resolveConfig(caminho)) ?? {};
  return format(conteudo, { ...config, filepath: caminho });
}

async function main() {
  const check = process.argv.includes('--check');
  const arquivos = {
    'gerado/openapi.ts': await gerarOpenApi(),
    'gerado/eventos.ts': await gerarEventos(),
    'index.ts': gerarIndice(),
  };
  const desatualizados = [];
  for (const [nome, bruto] of Object.entries(arquivos)) {
    const caminho = join(DESTINO, nome);
    const conteudo = await formatar(bruto, caminho);
    const atual = await readFile(caminho, 'utf8').catch(() => null);
    if (atual === conteudo) continue;
    if (check) {
      desatualizados.push(caminho);
    } else {
      await mkdir(dirname(caminho), { recursive: true });
      await writeFile(caminho, conteudo);
      console.log(`gerado ${caminho}`);
    }
  }
  if (desatualizados.length > 0) {
    console.error(
      `Tipos gerados desatualizados:\n${desatualizados.join('\n')}\nRode \`pnpm contracts:gen\`.`,
    );
    process.exit(1);
  }
}

await main();
