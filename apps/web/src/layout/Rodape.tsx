// Textos fixos de specs/012 §Rodapé. Item 1: texto oficial pt-BR do item 2 da Fan Content Policy
// da Wizards (verificado em 2026-10-24), com o título do conteúdo preenchido. Item 2: crédito à
// Scryfall, sem logo e sem sugerir endosso (specs/005). Não reescreva sem mudar a spec antes.
const URL_FAN_CONTENT_POLICY = 'https://company.wizards.com/pt-br/legal/fancontentpolicy';
const URL_SCRYFALL = 'https://scryfall.com';

export function Rodape() {
  return (
    <footer className="border-t border-borda bg-superficie">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-texto-suave">
        <p>
          Casa de Leilões é um conteúdo de fã não oficial permitido sob a{' '}
          <a href={URL_FAN_CONTENT_POLICY}>política de conteúdo de fãs</a>. Não aprovado/apoiado
          pela Wizards. Porções do material usado são propriedade da Wizards of the Coast. ©Wizards
          of the Coast LLC.
        </p>
        <p>
          Dados e imagens das cartas: <a href={URL_SCRYFALL}>Scryfall</a>.
        </p>
      </div>
    </footer>
  );
}
