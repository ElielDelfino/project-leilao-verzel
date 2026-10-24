/* global document, window */
// Aplica o tema antes da primeira pintura (evita o "flash" do tema errado). Script clássico e
// externo (não inline) para caber numa CSP com script-src 'self'. Espelha src/tema/tema.ts.
(function () {
  var tema;
  try {
    tema = window.localStorage.getItem('leilao:tema');
  } catch {
    // localStorage bloqueado: segue o sistema.
    tema = null;
  }
  if (tema !== 'light' && tema !== 'dark') {
    var escuro =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    tema = escuro ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = tema;
})();
