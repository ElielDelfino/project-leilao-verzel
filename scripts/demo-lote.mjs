#!/usr/bin/env node
// `pnpm demo:lote` (task 143): prepara, pela API HTTP pública do ambiente LOCAL, um lote ao vivo com
// lances para o avaliador testar a auditoria. Opcional e separado do seed (specs/003 RF-03).
//
// Segurança:
// - recusa, antes de qualquer requisição, NODE_ENV=production e API_URL com host fora de loopback;
// - nenhum acesso ao banco: só `fetch` do Node contra a API (CSRF por double-submit, specs/003);
// - nunca imprime senha, cookie nem corpo de requisição; erros de API saem só com o código.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]']);
const API_PADRAO = 'http://localhost:13000';
const ORIGEM_PADRAO = 'http://localhost:15173';
const VAR_SENHA = 'SEED_DEMO_PASSWORD';
const LANCE_INICIAL = 10_000;
const INCREMENTO = 1_000;
const QTD_LANCES = 8;
const DEPOSITO = 100_000;
const DURACAO_MS = 5 * 60 * 1000;
// Limite de lances: 10 por segundo por usuário (specs/007); 400 ms entre lances sobra.
const INTERVALO_PADRAO_MS = 400;

export class ErroDemo extends Error {
  name = 'ErroDemo';
}

/** Valida o ambiente antes de qualquer requisição; devolve a base da API sem barra final. */
export function validarAmbiente(env) {
  if (env.NODE_ENV === 'production') {
    throw new ErroDemo(
      'Recusado: NODE_ENV=production. Em produção o lote é criado à mão pelo painel.',
    );
  }
  let url;
  try {
    url = new URL(env.API_URL || API_PADRAO);
  } catch {
    throw new ErroDemo('Recusado: API_URL inválida.');
  }
  if (!HOSTS_LOCAIS.has(url.hostname)) {
    throw new ErroDemo(
      'Recusado: API_URL deve apontar para localhost, 127.0.0.1 ou ::1. Em produção o lote é criado à mão pelo painel.',
    );
  }
  return url.origin;
}

/** Sessão HTTP de uma conta: guarda cookies e envia Origin e X-CSRF-Token. */
function criarSessao(base, origem, fetchImpl) {
  const cookies = new Map();
  async function chamar(metodo, caminho, { corpo, cabecalhos = {} } = {}) {
    const headers = { Origin: origem, Accept: 'application/json', ...cabecalhos };
    if (cookies.size > 0) {
      headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (metodo !== 'GET') {
      headers['X-CSRF-Token'] = cookies.get('csrf_token') ?? '';
    }
    if (corpo !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const resposta = await fetchImpl(`${base}${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    for (const linha of resposta.headers.getSetCookie?.() ?? []) {
      const [par] = linha.split(';');
      const i = par.indexOf('=');
      if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
    const texto = await resposta.text();
    let json;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: resposta.status, json };
  }
  return { chamar };
}

function sucesso(resposta) {
  return resposta.status >= 200 && resposta.status < 300 && resposta.json?.sucesso !== false;
}

function codigoDoErro(resposta) {
  return resposta.json?.erro?.codigo ?? `HTTP_${resposta.status}`;
}

function exigir(resposta, passo) {
  if (sucesso(resposta)) return resposta.json?.dados;
  throw new ErroDemo(`Falha em "${passo}": ${codigoDoErro(resposta)}`);
}

async function entrar(base, origem, fetchImpl, email, senha) {
  const sessao = criarSessao(base, origem, fetchImpl);
  exigir(await sessao.chamar('GET', '/api/auth/csrf'), 'csrf');
  const r = await sessao.chamar('POST', '/api/auth/login', { corpo: { email, senha } });
  if (!sucesso(r)) {
    throw new ErroDemo(
      `Login de ${email} falhou (${codigoDoErro(r)}). Rode \`pnpm db:seed\` e tente de novo.`,
    );
  }
  return sessao;
}

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Executa o fluxo. `fetchImpl` e `intervaloMs` existem para os testes.
 * Devolve `{ loteId, linhas }` com a saída já montada.
 */
export async function executar({ env, saida = console.log, fetchImpl = fetch, intervaloMs } = {}) {
  const base = validarAmbiente(env);
  const origem = env.WEB_ORIGIN || ORIGEM_PADRAO;
  const senha = env[VAR_SENHA];
  if (!senha) {
    throw new ErroDemo(`${VAR_SENHA} ausente: defina-a no .env e rode \`pnpm db:seed\`.`);
  }
  const espera = intervaloMs ?? INTERVALO_PADRAO_MS;

  const leiloeiro = await entrar(base, origem, fetchImpl, 'leiloeiro@demo.local', senha);
  const ana = await entrar(base, origem, fetchImpl, 'ana@demo.local', senha);
  const bruno = await entrar(base, origem, fetchImpl, 'bruno@demo.local', senha);

  for (const [sessao, nome] of [
    [ana, 'ana'],
    [bruno, 'bruno'],
  ]) {
    exigir(
      await sessao.chamar('POST', '/api/carteira/depositos', {
        corpo: { valorCentavos: DEPOSITO },
        cabecalhos: { 'Idempotency-Key': randomUUID() },
      }),
      `depósito de ${nome}`,
    );
  }

  const cartas = exigir(
    await leiloeiro.chamar(
      'GET',
      `/api/catalogo/cartas?q=${encodeURIComponent('Lightning Bolt')}&pagina=1`,
    ),
    'busca de carta',
  );
  if (!Array.isArray(cartas) || cartas.length === 0) {
    throw new ErroDemo('A busca na Scryfall não devolveu cartas.');
  }

  const inicio = new Date();
  const lote = exigir(
    await leiloeiro.chamar('POST', '/api/painel/lotes', {
      corpo: {
        scryfallId: cartas[0].scryfallId,
        lanceInicialCentavos: LANCE_INICIAL,
        incrementoMinimoCentavos: INCREMENTO,
        inicioEm: inicio.toISOString(),
        fimEm: new Date(inicio.getTime() + DURACAO_MS).toISOString(),
      },
    }),
    'criação do lote',
  );

  const licitantes = [ana, bruno];
  for (let n = 0; n < QTD_LANCES; n += 1) {
    if (n > 0) await dormir(espera);
    exigir(
      await licitantes[n % 2].chamar('POST', `/api/lotes/${lote.id}/lances`, {
        corpo: { valorCentavos: LANCE_INICIAL + n * INCREMENTO },
        cabecalhos: { 'Idempotency-Key': randomUUID() },
      }),
      `lance ${n + 1}`,
    );
  }

  const web = origem.replace(/\/$/, '');
  const linhas = [
    `Lote criado com ${QTD_LANCES} lances: ${lote.id}`,
    `Sala:      ${web}/lotes/${lote.id}`,
    `Auditoria: ${web}/auditoria/${lote.id}`,
    `Adulterar: DEMO_ADULTERAR=1 pnpm demo:adulterar --lote ${lote.id} --seq 1`,
    'O lote nasce ao vivo e dura 5 minutos; o comprovante só aparece depois do encerramento.',
  ];
  for (const linha of linhas) saida(linha);
  return { loteId: lote.id, linhas };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  executar({ env: process.env }).catch((erro) => {
    console.error(
      erro instanceof ErroDemo ? erro.message : `Erro inesperado (${erro?.name ?? 'Error'}).`,
    );
    process.exit(1);
  });
}
