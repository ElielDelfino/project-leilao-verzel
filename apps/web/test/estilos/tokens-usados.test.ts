import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import tokensCss from '../../src/estilos/tokens.css?raw';

// Garante que as telas (inclusive as da F4) só usam cores vindas dos tokens, que têm contraste
// AA verificado nos dois temas (contraste.test.ts), e que as imagens de carta ficam sem filtro,
// sombra ou recorte (sem halo no fundo escuro; specs/005 e 012).

const RAIZ = join(__dirname, '../../src');

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTsx(caminho);
    return caminho.endsWith('.tsx') ? [caminho] : [];
  });
}

const FONTES = arquivosTsx(RAIZ).map((caminho) => ({
  caminho,
  texto: readFileSync(caminho, 'utf8'),
}));

const tokensDefinidos = new Set(
  [...tokensCss.matchAll(/--cor-([a-z-]+):/g)].map((m) => m[1] as string),
);
// Sem token: sobreposição do diálogo (preto translúcido) e cores herdadas.
const SEM_TOKEN = new Set(['black/60', 'current', 'transparent']);

const PREFIXOS = 'bg|text|border|ring|outline|decoration|divide|fill|stroke';
const PALETA_CRUA =
  'red|green|emerald|amber|yellow|blue|zinc|slate|gray|neutral|stone|rose|orange|sky|white|black';

describe('cores usadas nas telas', () => {
  it('nenhuma tela usa cor crua da paleta do Tailwind (exceto a sobreposição do diálogo)', () => {
    const crua = new RegExp(`\\b(?:${PREFIXOS})-(?:${PALETA_CRUA})(?:-\\d+)?(?:/\\d+)?\\b`, 'g');
    const achados: string[] = [];
    for (const { caminho, texto } of FONTES) {
      for (const [classe] of texto.matchAll(crua)) {
        if (!SEM_TOKEN.has(classe.replace(/^[a-z]+-/, ''))) achados.push(`${caminho}: ${classe}`);
      }
    }
    expect(achados).toEqual([]);
  });

  it('toda classe de cor com nome de token aponta para um token definido nos dois temas', () => {
    const usadas = new Set<string>();
    const tokenUsado = new RegExp(
      `\\b(?:${PREFIXOS})-(borda-controle|borda|texto-sobre-primario|texto-suave|texto|superficie|fundo|poco|primario|link|foco|destaque|sucesso|perigo|aviso)\\b`,
      'g',
    );
    for (const { texto } of FONTES) {
      for (const m of texto.matchAll(tokenUsado)) usadas.add(m[1] as string);
    }
    expect([...usadas].filter((nome) => !tokensDefinidos.has(nome))).toEqual([]);
    expect(usadas.size).toBeGreaterThan(0);
  });

  // `rounded` fica de fora: Miniatura.tsx (novo-lote) o usa e está fora dos arquivos da 119.
  it('imagens de carta não têm filtro, sombra, opacidade nem recorte por cover', () => {
    const proibidas =
      /\b(?:drop-shadow|shadow|blur|brightness|contrast|grayscale|opacity|object-cover|mix-blend|invert)[a-z0-9-]*/;
    const achados: string[] = [];
    let imagens = 0;
    for (const { caminho, texto } of FONTES) {
      for (const [img] of texto.matchAll(/<img[\s\S]*?\/>/g)) {
        imagens += 1;
        if (proibidas.test(img)) achados.push(caminho);
      }
    }
    expect(imagens).toBeGreaterThan(0);
    expect(achados).toEqual([]);
  });
});
