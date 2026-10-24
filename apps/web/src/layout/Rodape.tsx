// Aviso exigido pela Fan Content Policy da Wizards e crédito à Scryfall (specs/005 §UI, specs/012).
export function Rodape() {
  return (
    <footer className="border-t border-borda bg-superficie">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-texto-suave">
        <p>
          A Casa de Leilões é Conteúdo de Fã não oficial, permitido pela{' '}
          <a href="https://company.wizards.com/en/legal/fancontentpolicy">
            Política de Conteúdo de Fãs
          </a>
          . Não é aprovada nem endossada pela Wizards. Partes dos materiais usados são propriedade
          da Wizards of the Coast. © Wizards of the Coast LLC.
        </p>
        <p>
          Dados e imagens das cartas: <a href="https://scryfall.com">Scryfall</a>. Saldos e lances
          são simulados.
        </p>
      </div>
    </footer>
  );
}
