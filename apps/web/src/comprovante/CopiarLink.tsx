import { useEffect, useRef, useState } from 'react';

import { urlDoComprovante } from './links';

type Situacao = 'parado' | 'copiado' | 'manual';

/** Copia o link com `navigator.clipboard`; sem ele (ou se recusar), mostra o campo para copiar. */
export function CopiarLink({ codigo }: { codigo: string }) {
  const [situacao, setSituacao] = useState<Situacao>('parado');
  const campo = useRef<HTMLInputElement>(null);
  const url = urlDoComprovante(codigo);

  useEffect(() => {
    if (situacao !== 'manual') return;
    campo.current?.focus();
    campo.current?.select();
  }, [situacao]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setSituacao('copiado');
    } catch {
      setSituacao('manual');
    }
  }

  return (
    <div className="mt-6 flex flex-col items-start gap-3 border-t border-borda pt-6">
      <button type="button" onClick={() => void copiar()} className="botao-secundario">
        Copiar link
      </button>
      <div role="status" className="text-sm font-medium text-sucesso">
        {situacao === 'copiado' ? 'Link copiado.' : null}
      </div>
      {situacao === 'manual' ? (
        <div className="w-full">
          <p>Não foi possível copiar automaticamente. Copie o link abaixo.</p>
          <label htmlFor="link-do-comprovante" className="rotulo mt-2 block">
            Link do comprovante
          </label>
          <input
            id="link-do-comprovante"
            ref={campo}
            readOnly
            value={url}
            className="controle mt-1"
          />
        </div>
      ) : null}
    </div>
  );
}
