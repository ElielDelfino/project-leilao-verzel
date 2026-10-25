// axe-core nos specs de acessibilidade (task 041/043): WCAG 2.0/2.1/2.2 A e AA; só impacto
// serious ou critical é bloqueante.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const IMPACTOS_BLOQUEANTES = new Set(['serious', 'critical']);

export interface ViolacaoBloqueante {
  readonly regra: string;
  readonly impacto: string | null | undefined;
  readonly nos: readonly string[];
}

/**
 * Espera o estado estável antes do axe: h1 visível e nenhum "Carregando…" na tela (os estados
 * transitórios das rotas protegidas trocam o conteúdo e davam falso positivo/negativo).
 */
export async function aguardarEstadoEstavel(page: Page): Promise<void> {
  await expect(page.locator('main#conteudo')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Carregando…')).toHaveCount(0);
}

export async function violacoesBloqueantes(page: Page): Promise<ViolacaoBloqueante[]> {
  const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return resultado.violations
    .filter((v) => v.impact != null && IMPACTOS_BLOQUEANTES.has(v.impact))
    .map((v) => ({
      regra: v.id,
      impacto: v.impact,
      nos: v.nodes.map((n) => n.target.join(' ')),
    }));
}
