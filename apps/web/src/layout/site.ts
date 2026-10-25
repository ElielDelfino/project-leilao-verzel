// Constantes do site, num módulo sem componentes (o Fast Refresh só recarrega módulos que
// exportam apenas componentes).
export const NOME_DO_SITE = 'Casa de Leilões';

/** id do `<main>`: alvo do link "Pular para o conteúdo" e do foco ao trocar de rota. */
export const ID_CONTEUDO = 'conteudo';

/** `<title>` de uma página: "<título> · Casa de Leilões". */
export function tituloDaPagina(titulo: string): string {
  return `${titulo} · ${NOME_DO_SITE}`;
}
