import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { ErroDaApi } from '../api/erro';
import { cancelarLote } from '../api/painel';
import type { Lote } from '../api/lotes';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { DialogoDeConfirmacao } from './DialogoDeConfirmacao';

export interface AvisoDoPainel {
  tipo: 'sucesso' | 'erro';
  texto: string;
}

export const AVISO_LOTE_CANCELADO: AvisoDoPainel = {
  tipo: 'sucesso',
  texto: 'Lote cancelado. Se havia líder, o valor reservado foi estornado.',
};
const AVISO_LOTE_ENCERRADO: AvisoDoPainel = {
  tipo: 'erro',
  texto: 'Não foi possível cancelar: o lote já foi encerrado ou cancelado.',
};
const AVISO_NAO_ENCONTRADO: AvisoDoPainel = {
  tipo: 'erro',
  texto: 'Não encontramos este lote. A lista foi atualizada.',
};

/** Aviso de specs/012 §Cancelar lote para erros que fecham o diálogo; null = fica no diálogo. */
function avisoDoErro(erro: unknown): AvisoDoPainel | null {
  if (!(erro instanceof ErroDaApi)) return null;
  if (erro.status === 404) return AVISO_NAO_ENCONTRADO;
  if (erro.status === 409 && erro.codigo === 'LOTE_ENCERRADO') return AVISO_LOTE_ENCERRADO;
  return null;
}

interface Props {
  lote: Pick<Lote, 'id' | 'titulo'>;
  aoConcluir: (aviso: AvisoDoPainel) => void;
}

/** Botão "Cancelar lote" e diálogo de confirmação (specs/012 §Cancelar lote). */
export function CancelarLote({ lote, aoConcluir }: Props) {
  const clienteDeConsultas = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const manter = useRef<HTMLButtonElement>(null);
  // Trava síncrona: o estado do React só atualiza no próximo render, depois do segundo clique.
  const enviando = useRef(false);

  const cancelamento = useMutation({
    mutationFn: () => cancelarLote(lote.id),
    onSettled: () => {
      enviando.current = false;
      void clienteDeConsultas.invalidateQueries({ queryKey: ['painel'] });
    },
    onSuccess: () => {
      setAberto(false);
      aoConcluir(AVISO_LOTE_CANCELADO);
    },
    onError: (erro) => {
      const aviso = avisoDoErro(erro);
      if (!aviso) return;
      setAberto(false);
      aoConcluir(aviso);
    },
  });

  function confirmar() {
    if (enviando.current) return;
    enviando.current = true;
    cancelamento.mutate();
  }

  function fechar() {
    cancelamento.reset();
    setAberto(false);
  }

  const ocupado = cancelamento.isPending;
  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-label={`Cancelar lote ${lote.titulo}`}
        onClick={() => setAberto(true)}
        className="min-h-11 rounded-md border border-borda-controle px-3 font-medium"
      >
        Cancelar lote
      </button>
      {aberto ? (
        <DialogoDeConfirmacao
          titulo="Cancelar este lote?"
          aoFechar={fechar}
          origem={botao}
          ocupado={ocupado}
          focoInicial={manter}
        >
          <p className="mt-2">
            {`O lote "${lote.titulo}" será cancelado e não poderá ser reaberto. Se houver um líder, o valor reservado para o lance dele será estornado.`}
          </p>
          {cancelamento.error ? (
            <div className="mt-4">
              <ErroDoServidor erro={cancelamento.error} />
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={confirmar}
              disabled={ocupado}
              className="min-h-11 rounded-md border border-primario bg-primario px-4 font-medium text-texto-sobre-primario disabled:opacity-60"
            >
              {ocupado ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
            <button
              ref={manter}
              type="button"
              onClick={fechar}
              disabled={ocupado}
              className="min-h-11 rounded-md border border-borda-controle px-4 font-medium disabled:opacity-60"
            >
              Manter lote
            </button>
          </div>
        </DialogoDeConfirmacao>
      ) : null}
    </>
  );
}
