// Cabeçalhos de segurança da própria API (tarefa 020), só fora de produção (dev, teste local da
// imagem sem o Caddy na frente). Em produção quem os põe é o Caddy (infra/caddy/Caddyfile), e o
// reverse_proxy dele SOMA os cabeçalhos do upstream aos seus: se a API também os mandasse, cada um
// sairia duas vezes, e um `cross-origin-opener-policy: same-origin, same-origin` é inválido e
// ignorado pelo navegador. Por isso endurecerHttp não registra este ouvinte quando `producao`.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export const CABECALHOS_DE_SEGURANCA: Readonly<Record<string, string>> = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
});

function aplicar(_requisicao: IncomingMessage, resposta: ServerResponse): void {
  for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
    resposta.setHeader(nome, valor);
  }
}

/**
 * Põe os cabeçalhos na resposta antes de o Fastify ver a requisição, como primeiro ouvinte de
 * `request` do servidor do Node. Assim eles saem também nas respostas que não passam pelos hooks
 * do Fastify: o 400/414 do roteador (`frameworkErrors`) e o 503 do encerramento. Uma rota que
 * defina o mesmo cabeçalho o substitui (o `writeHead` do Fastify vence o `setHeader`).
 */
export function registrarCabecalhosDeSeguranca(servidor: Server): void {
  servidor.prependListener('request', aplicar);
}
