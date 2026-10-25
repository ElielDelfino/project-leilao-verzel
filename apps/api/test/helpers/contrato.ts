// Validador de contrato (task 041, specs/013 §Contratos): confere status, headers obrigatórios e
// corpo de uma resposta contra a operação do apps/api/openapi.yaml, com Ajv 2020-12 e ajv-formats.
// Os $ref são resolvidos só dentro do arquivo ("#/..."); qualquer outro $ref lança.
import { readFileSync } from 'node:fs';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const CAMINHO_DO_CONTRATO = new URL('../../openapi.yaml', import.meta.url);
const ID_DO_CONTRATO = 'urn:leilao:openapi';
const METODOS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);

/**
 * Status sem declaração própria que ainda passam pelo `default` (specs/001 §Erros): 4xx do
 * framework (400, 401, 403, 404, 405, 409, 413, 414, 415, 422 e 429) e 5xx (500/503 INDISPONIVEL).
 */
const STATUS_DO_DEFAULT = new Set([
  400, 401, 403, 404, 405, 409, 413, 414, 415, 422, 429, 500, 503,
]);

type Json = Record<string, unknown>;

export interface RespostaObservada {
  /** Verbo HTTP, sem diferenciar caixa. */
  readonly metodo: string;
  /** Caminho exatamente como no `paths` do contrato (ex.: `/api/lotes/{id}`). */
  readonly caminho: string;
  readonly status: number;
  /** Nomes sem diferenciar caixa. */
  readonly headers: Readonly<Record<string, string>>;
  readonly corpo: unknown;
}

const contrato = parse(readFileSync(CAMINHO_DO_CONTRATO, 'utf8')) as Json;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema({ $id: ID_DO_CONTRATO, ...contrato });

function ehObjeto(valor: unknown): valor is Json {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function seguirPonteiro(ref: string): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`contrato: só $ref locais são aceitos (recebi ${JSON.stringify(ref)})`);
  }
  let atual: unknown = contrato;
  for (const parte of ref.slice(2).split('/')) {
    const chave = parte.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!ehObjeto(atual) || !(chave in atual)) {
      throw new Error(`contrato: $ref sem destino: ${ref}`);
    }
    atual = atual[chave];
  }
  return atual;
}

/** Resolve `$ref` encadeados de um objeto (resposta, header). */
function resolver(valor: unknown): unknown {
  let atual = valor;
  while (ehObjeto(atual) && typeof atual['$ref'] === 'string') {
    atual = seguirPonteiro(atual['$ref']);
  }
  return atual;
}

/** Copia o schema trocando "#/..." por "urn:...#/...", para o Ajv achar os $ref no documento. */
function ancorar(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(ancorar);
  }
  if (!ehObjeto(schema)) {
    return schema;
  }
  const copia: Json = {};
  for (const [chave, valor] of Object.entries(schema)) {
    if (chave === '$ref' && typeof valor === 'string') {
      seguirPonteiro(valor);
      copia[chave] = `${ID_DO_CONTRATO}${valor}`;
    } else {
      copia[chave] = ancorar(valor);
    }
  }
  return copia;
}

const validadores = new Map<unknown, ValidateFunction>();

function validador(schema: unknown): ValidateFunction {
  let pronto = validadores.get(schema);
  if (pronto === undefined) {
    pronto = ajv.compile(ancorar(schema) as object);
    validadores.set(schema, pronto);
  }
  return pronto;
}

function descreverErros(validar: ValidateFunction): string {
  return (validar.errors ?? [])
    .map((e) => `${e.instancePath || '/'} ${e.message ?? ''} ${JSON.stringify(e.params)}`)
    .join('; ');
}

function acharOperacao(metodo: string, caminho: string): Json {
  const rota = ehObjeto(contrato['paths']) ? contrato['paths'][caminho] : undefined;
  const verbo = metodo.toLowerCase();
  const operacao = ehObjeto(rota) && METODOS.has(verbo) ? rota[verbo] : undefined;
  if (!ehObjeto(operacao)) {
    throw new Error(`contrato: operação ${metodo.toUpperCase()} ${caminho} não existe`);
  }
  return operacao;
}

function acharResposta(operacao: Json, status: number, rotulo: string): Json {
  const respostas = ehObjeto(operacao['responses']) ? operacao['responses'] : {};
  const declarada = respostas[String(status)];
  if (declarada !== undefined) {
    return resolver(declarada) as Json;
  }
  if (respostas['default'] !== undefined && STATUS_DO_DEFAULT.has(status)) {
    return resolver(respostas['default']) as Json;
  }
  throw new Error(`contrato: ${rotulo} não declara o status ${status}`);
}

function validarHeaders(
  resposta: Json,
  observados: Readonly<Record<string, string>>,
  status: number,
) {
  const minusculos = new Map(Object.entries(observados).map(([k, v]) => [k.toLowerCase(), v]));
  const declarados = ehObjeto(resposta['headers']) ? resposta['headers'] : {};
  const exigidos = new Map<string, Json>();
  for (const [nome, definicao] of Object.entries(declarados)) {
    exigidos.set(nome.toLowerCase(), resolver(definicao) as Json);
  }
  // Todo 429 leva Retry-After, também quando passa pelo default (specs/001 §Erros).
  if (status === 429 && !exigidos.has('retry-after')) {
    exigidos.set('retry-after', { required: true, schema: { type: 'integer', minimum: 1 } });
  }
  for (const [nome, definicao] of exigidos) {
    const valor = minusculos.get(nome);
    if (valor === undefined) {
      if (definicao['required'] === true) {
        throw new Error(
          `contrato: header obrigatório ausente: ${nome === 'retry-after' ? 'Retry-After' : nome}`,
        );
      }
      continue;
    }
    if (definicao['schema'] === undefined || nome === 'set-cookie') {
      continue;
    }
    const esquema = definicao['schema'] as Json;
    const convertido = esquema['type'] === 'integer' ? Number(valor) : valor;
    const validar = validador(esquema);
    if (!validar(convertido)) {
      throw new Error(
        `contrato: header ${nome === 'retry-after' ? 'Retry-After' : nome} inválido: ${descreverErros(validar)}`,
      );
    }
  }
}

function validarCorpo(
  resposta: Json,
  corpo: unknown,
  rotulo: string,
  contentType: string | undefined,
): void {
  const conteudo = ehObjeto(resposta['content']) ? resposta['content'] : undefined;
  const json = conteudo?.['application/json'];
  // Corpo binário (ex.: image/png de /api/imagens): basta o Content-Type ser um dos declarados.
  const tipo = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (tipo !== 'application/json' && conteudo !== undefined && tipo in conteudo) {
    return;
  }
  if (!ehObjeto(json) || json['schema'] === undefined) {
    if (corpo !== undefined && corpo !== null && corpo !== '') {
      throw new Error(`contrato: ${rotulo} não declara corpo, mas a resposta trouxe um`);
    }
    return;
  }
  const validar = validador(json['schema']);
  if (!validar(corpo)) {
    throw new Error(`contrato: corpo de ${rotulo} fora do contrato: ${descreverErros(validar)}`);
  }
}

/** Lança com o motivo se a resposta não cumpre a operação do openapi.yaml; não devolve nada. */
export function validarContrato(resposta: RespostaObservada): void {
  const rotulo = `${resposta.metodo.toUpperCase()} ${resposta.caminho} -> ${resposta.status}`;
  const operacao = acharOperacao(resposta.metodo, resposta.caminho);
  const declarada = acharResposta(operacao, resposta.status, rotulo);
  validarHeaders(declarada, resposta.headers, resposta.status);
  const contentType = Object.entries(resposta.headers).find(
    ([nome]) => nome.toLowerCase() === 'content-type',
  )?.[1];
  validarCorpo(declarada, resposta.corpo, rotulo, contentType);
}

/** Rotas do contrato como expressões regulares: `/api/lotes/{id}` casa `/api/lotes/abc`. */
const padroesDeCaminho: readonly { readonly caminho: string; readonly padrao: RegExp }[] =
  Object.keys(ehObjeto(contrato['paths']) ? contrato['paths'] : {}).map((caminho) => ({
    caminho,
    padrao: new RegExp(
      `^${caminho
        .split(/\{[^}]+\}/)
        .map((trecho) => trecho.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
        .join('[^/]+')}$`,
    ),
  }));

/** Caminho do `paths` que casa com a URL (sem query), ou undefined se o contrato não o declara. */
export function caminhoDoContrato(url: string): string | undefined {
  const semQuery = url.split('?')[0] ?? url;
  return padroesDeCaminho.find((p) => p.padrao.test(semQuery))?.caminho;
}

/** Operações (método + caminho) declaradas no contrato, opcionalmente só de uma tag. */
export function operacoesDoContrato(tag?: string): { metodo: string; caminho: string }[] {
  const paths = ehObjeto(contrato['paths']) ? contrato['paths'] : {};
  const operacoes: { metodo: string; caminho: string }[] = [];
  for (const [caminho, rota] of Object.entries(paths)) {
    if (!ehObjeto(rota)) continue;
    for (const [metodo, operacao] of Object.entries(rota)) {
      if (!METODOS.has(metodo) || !ehObjeto(operacao)) continue;
      const tags = Array.isArray(operacao['tags']) ? operacao['tags'] : [];
      if (tag === undefined || tags.includes(tag)) operacoes.push({ metodo, caminho });
    }
  }
  return operacoes;
}

const METODOS_SEM_CSRF = new Set(['get', 'head', 'options']);

/**
 * Se a operação exige CSRF (specs/003: todo método fora de GET/HEAD/OPTIONS). Lança se o contrato
 * não declara esse método nesse caminho, em vez de a matriz assumir um valor à mão (LOW da 043).
 */
export function exigeCsrf(metodo: string, caminho: string): boolean {
  acharOperacao(metodo, caminho);
  return !METODOS_SEM_CSRF.has(metodo.toLowerCase());
}

/** Todo schema `type: object` do contrato sem `additionalProperties` explícito (JSON pointer). */
export function objetosSemAdditionalProperties(): string[] {
  const achados: string[] = [];
  const percorrer = (no: unknown, ponteiro: string): void => {
    if (Array.isArray(no)) {
      no.forEach((item, i) => percorrer(item, `${ponteiro}/${i}`));
    } else if (ehObjeto(no)) {
      if (no['type'] === 'object' && !('additionalProperties' in no)) achados.push(ponteiro);
      for (const [chave, valor] of Object.entries(no)) percorrer(valor, `${ponteiro}/${chave}`);
    }
  };
  percorrer(contrato, '#');
  return achados;
}
