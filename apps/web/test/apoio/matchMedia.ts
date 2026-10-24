import { vi } from 'vitest';

type Ouvinte = (evento: MediaQueryListEvent) => void;

export interface PreferenciaDoSistema {
  /** Muda `prefers-color-scheme` e avisa quem escuta `change`. */
  definirEscuro: (escuro: boolean) => void;
}

/**
 * O jsdom não implementa `matchMedia`. Este dublê responde só a `prefers-color-scheme: dark`
 * e dispara `change` como o navegador quando a preferência do sistema muda.
 */
export function simularPreferenciaDoSistema(escuroInicial: boolean): PreferenciaDoSistema {
  let escuro = escuroInicial;
  const ouvintes = new Set<Ouvinte>();

  vi.stubGlobal('matchMedia', (consulta: string): MediaQueryList => {
    const ehEscuro = consulta === '(prefers-color-scheme: dark)';
    return {
      get matches() {
        return ehEscuro && escuro;
      },
      media: consulta,
      onchange: null,
      addEventListener: (_tipo: string, ouvinte: Ouvinte) => ouvintes.add(ouvinte),
      removeEventListener: (_tipo: string, ouvinte: Ouvinte) => ouvintes.delete(ouvinte),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  });

  return {
    definirEscuro(novo) {
      escuro = novo;
      const evento = {
        matches: novo,
        media: '(prefers-color-scheme: dark)',
      } as MediaQueryListEvent;
      ouvintes.forEach((ouvinte) => ouvinte(evento));
    },
  };
}
