import type { HTMLInputTypeAttribute } from 'react';

type Props = {
  nome: string;
  rotulo: string;
  tipo?: HTMLInputTypeAttribute;
  erro?: string | undefined;
  autoComplete?: string;
  inputMode?: 'text' | 'decimal';
  ajuda?: string;
  valor?: string;
  aoMudar?: (valor: string) => void;
  desabilitado?: boolean;
};

const CLASSE_ENTRADA =
  'mt-1 block min-h-11 w-full rounded-md border border-borda-controle bg-superficie px-3 text-texto';

/** Campo de formulário: `<label>`, e `aria-describedby`/`aria-invalid` quando há erro ou ajuda. */
export function Campo({
  nome,
  rotulo,
  tipo = 'text',
  erro,
  autoComplete,
  inputMode,
  ajuda,
  valor,
  aoMudar,
  desabilitado,
}: Props) {
  const idErro = `${nome}-erro`;
  const idAjuda = `${nome}-ajuda`;
  const descricao = [ajuda ? idAjuda : null, erro ? idErro : null].filter(Boolean).join(' ');
  const controlado =
    valor === undefined || !aoMudar
      ? {}
      : { value: valor, onChange: (e: { target: { value: string } }) => aoMudar(e.target.value) };

  return (
    <div>
      <label htmlFor={nome} className="font-medium">
        {rotulo}
      </label>
      <input
        id={nome}
        name={nome}
        type={tipo}
        autoComplete={autoComplete}
        disabled={desabilitado}
        inputMode={inputMode}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricao || undefined}
        className={CLASSE_ENTRADA}
        {...controlado}
      />
      {ajuda ? (
        <p id={idAjuda} className="mt-1 text-sm text-texto-suave">
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={idErro} className="mt-1 text-sm font-medium">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
