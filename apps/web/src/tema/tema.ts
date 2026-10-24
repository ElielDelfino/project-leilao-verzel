// Dark mode (specs/012 §Comportamento): tokens em :root e [data-theme="dark"]; segue
// prefers-color-scheme por padrão; a escolha manual fica salva no localStorage.
// public/tema-inicial.js repete esta lógica antes da primeira pintura; mantenha os dois iguais
// (test/tema/tema-inicial.test.ts verifica a chave e os valores).

export type Tema = 'light' | 'dark';

export const CHAVE_TEMA = 'leilao:tema';
export const CONSULTA_SISTEMA_ESCURO = '(prefers-color-scheme: dark)';

function ehTema(valor: unknown): valor is Tema {
  return valor === 'light' || valor === 'dark';
}

/** Escolha salva, ou null se não houver, for desconhecida ou o armazenamento estiver bloqueado. */
export function lerTemaSalvo(): Tema | null {
  try {
    const valor = window.localStorage.getItem(CHAVE_TEMA);
    return ehTema(valor) ? valor : null;
  } catch {
    // localStorage bloqueado (modo privado, política do navegador): segue o sistema.
    return null;
  }
}

/** Salva a escolha; se o armazenamento estiver bloqueado, o tema vale só nesta página. */
export function salvarTema(tema: Tema): void {
  try {
    window.localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    // Sem persistência possível; a troca continua valendo na sessão atual.
  }
}

export function consultaSistemaEscuro(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(CONSULTA_SISTEMA_ESCURO)
    : null;
}

export function temaDoSistema(): Tema {
  return consultaSistemaEscuro()?.matches ? 'dark' : 'light';
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset['theme'] = tema;
}
