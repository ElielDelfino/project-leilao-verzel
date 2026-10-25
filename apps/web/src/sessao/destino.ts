import type { SchemasApi } from '@leilao/contracts';

export type Papel = SchemasApi['Papel'];

// Acesso por rota (specs/012 §Rotas; D11 da tarefa 036).
const PREFIXOS_SO_LICITANTE = ['/carteira', '/meus-arremates'] as const;
const PREFIXOS_SO_LEILOEIRO = ['/painel'] as const;
const ROTAS_DE_ACESSO = ['/entrar', '/cadastro'] as const;
const ORIGEM_FALSA = 'http://destino.invalido';

function casaComPrefixo(caminho: string, prefixo: string): boolean {
  return caminho === prefixo || caminho.startsWith(`${prefixo}/`);
}

/** Destino padrão depois de entrar: `/` para licitante, `/painel` para leiloeiro. */
export function destinoDoPapel(papel: Papel): string {
  return papel === 'leiloeiro' ? '/painel' : '/';
}

export function papelPodeAcessar(papel: Papel, caminho: string): boolean {
  const proibidos = papel === 'licitante' ? PREFIXOS_SO_LEILOEIRO : PREFIXOS_SO_LICITANTE;
  const exclusivos = [...PREFIXOS_SO_LICITANTE, ...PREFIXOS_SO_LEILOEIRO];
  if (!exclusivos.some((p) => casaComPrefixo(caminho, p))) return true;
  return !proibidos.some((p) => casaComPrefixo(caminho, p));
}

/**
 * Destino depois de entrar: o `retorno` só vale se for caminho interno (começa com `/`, não começa com
 * `//` e não contém `\`) e permitido ao papel; senão, o destino do papel.
 */
export function destinoPosLogin(retorno: string | null, papel: Papel): string {
  const padrao = destinoDoPapel(papel);
  if (!retorno?.startsWith('/') || retorno.startsWith('//') || retorno.includes('\\')) {
    return padrao;
  }
  let url: URL;
  try {
    url = new URL(retorno, ORIGEM_FALSA);
  } catch {
    return padrao;
  }
  if (url.origin !== ORIGEM_FALSA) return padrao;
  // Depois de normalizar (`/.//x`, `/%2e//x`) o caminho não pode virar "protocol-relative".
  if (url.pathname.startsWith('//') || url.pathname.startsWith('/\\')) return padrao;
  if (ROTAS_DE_ACESSO.some((rota) => casaComPrefixo(url.pathname, rota))) return padrao;
  if (!papelPodeAcessar(papel, url.pathname)) return padrao;
  return `${url.pathname}${url.search}${url.hash}`;
}
