// As três contas do seed (specs/003 RF-03). A senha é pública de propósito (ADR 0023).
const SENHA_DA_DEMONSTRACAO = 'leilao-demo-2026';

const CONTAS = [
  { papel: 'Leiloeiro', email: 'leiloeiro@demo.local' },
  { papel: 'Licitante', email: 'helena@demo.local' },
  { papel: 'Licitante', email: 'otavio@demo.local' },
] as const;

/** Contas de teste para quem avalia o projeto, abaixo do formulário de entrar. */
export function ContasDeDemonstracao() {
  return (
    <section
      aria-labelledby="contas-de-demonstracao"
      className="mt-6 rounded-xl border border-borda bg-poco p-4 text-sm"
    >
      <h2 id="contas-de-demonstracao" className="font-bold">
        Contas de demonstração
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {CONTAS.map((conta) => (
          <li key={conta.email} className="flex flex-col gap-0.5">
            <span className="text-texto-suave">{conta.papel}</span>
            <span className="font-semibold break-all">{conta.email}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-texto-suave">
        Senha das três: <span className="font-semibold text-texto">{SENHA_DA_DEMONSTRACAO}</span>
      </p>
    </section>
  );
}
