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
  maxLength?: number;
};

const CLASSE_ENTRADA =
  'controle mt-1.5 block aria-invalid:border-perigo aria-invalid:ring-1 aria-invalid:ring-perigo';

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
  maxLength,
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
      <label htmlFor={nome} className="rotulo">
        {rotulo}
      </label>
      <input
        id={nome}
        name={nome}
        type={tipo}
        autoComplete={autoComplete}
        disabled={desabilitado}
        inputMode={inputMode}
        maxLength={maxLength}
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
        <p id={idErro} className="mt-1 text-sm font-semibold text-perigo">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
