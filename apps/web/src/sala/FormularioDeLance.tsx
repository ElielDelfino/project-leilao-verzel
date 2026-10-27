import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Link, useLocation } from 'react-router';

import { ErroDaApi } from '../api/erro';
import { darLance } from '../api/lances';
import { centavosParaReais, reaisParaCentavosDoLance } from '../formatacao/lance';
import { formatarCentavos } from '../formatacao/dinheiro';
import { mensagemDoErro, type ContextoDaMensagem } from '../mensagens/erros';
import { useSessao } from '../sessao/useSessao';
import type { LoteDoEstado } from './tiposDoServidor';

const TEXTO_VALOR_INVALIDO = 'Informe um valor em reais, como 150,00.';

/** Mínimo do próximo lance, em centavos inteiros (specs/007): inicial, ou atual + incremento. */
export function lanceMinimo(lote: LoteDoEstado): number {
  return lote.lanceAtualCentavos === null
    ? lote.lanceInicialCentavos
    : lote.lanceAtualCentavos + lote.incrementoMinimoCentavos;
}

interface Tentativa {
  chave: string;
  valorCentavos: number;
}

interface Props {
  lote: LoteDoEstado;
  /** Refaz o `entrar_lote` (resync) depois de recusas que indicam estado desatualizado. */
  aoSincronizar: () => void;
  /** Sem conexão com a sala: o formulário fica desabilitado (specs/012). */
  reconectando?: boolean | undefined;
}

/** Só inteiro seguro não negativo: centavos negativos fariam `centavosParaReais` lançar. */
export function numeroDe(detalhes: Record<string, unknown> | undefined, campo: string) {
  const valor = detalhes?.[campo];
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0 ? valor : undefined;
}

/** Formulário de lance: sem otimismo, trava síncrona e Idempotency-Key por tentativa (specs/012). */
function Formulario({ lote, aoSincronizar, reconectando = false }: Props) {
  const minimo = lanceMinimo(lote);
  const [falhaLocal, setFalhaLocal] = useState(false);
  // `null` = o usuário não editou: o campo acompanha o mínimo (que muda a cada `lance_aceito`).
  const [editado, setEditado] = useState<string | null>(null);
  const [erroDoCampo, setErroDoCampo] = useState<string | null>(null);
  const [registrado, setRegistrado] = useState('');
  const entrada = useRef<HTMLInputElement>(null);
  const travado = useRef(false);
  const tentativa = useRef<Tentativa | null>(null);

  const valorDoCampo = editado ?? centavosParaReais(minimo);

  const lance = useMutation({
    mutationFn: ({ chave, valorCentavos }: Tentativa) => darLance(lote.id, valorCentavos, chave),
    onSuccess: (_dados, { valorCentavos }) => {
      tentativa.current = null;
      setEditado(null);
      setRegistrado(`Lance de ${formatarCentavos(valorCentavos)} registrado.`);
      // O campo é só `readOnly` durante o envio (continua focável); o botão clicado ficou desabilitado.
      entrada.current?.focus();
    },
    onError: (erro) => {
      // Resposta definitiva: um novo envio é outra operação. Resultado incerto mantém a chave.
      if (!(erro instanceof ErroDaApi) || !erro.resultadoIncerto) tentativa.current = null;
      if (erro instanceof ErroDaApi) {
        const minimoDaApi = numeroDe(erro.detalhes, 'minimoCentavos');
        if (erro.codigo === 'LANCE_ABAIXO_DO_MINIMO' && minimoDaApi !== undefined) {
          setEditado(centavosParaReais(minimoDaApi));
        }
        if (erro.codigo === 'LOTE_ENCERRADO' || erro.codigo === 'LOTE_NAO_INICIADO') {
          aoSincronizar();
        }
      }
    },
    onSettled: () => {
      travado.current = false;
    },
  });

  // O campo fica desabilitado durante o envio: o foco só pode voltar depois da recusa renderizada.
  const falhou = lance.error;
  useEffect(() => {
    if (falhou) entrada.current?.focus();
  }, [falhou]);

  function enviar(valorCentavos: number) {
    // Trava síncrona: o estado do React só muda no próximo render, o ref vale já neste tick.
    if (travado.current || reconectando) return;
    setRegistrado('');
    setFalhaLocal(false);
    // A chave só é reaproveitada na repetição da mesma tentativa (mesmo valor).
    // Gerada ANTES de ligar a trava: se falhar, o formulário continua utilizável.
    const anterior = tentativa.current;
    let atual: Tentativa;
    try {
      atual =
        anterior?.valorCentavos === valorCentavos
          ? anterior
          : { chave: crypto.randomUUID(), valorCentavos };
    } catch {
      setFalhaLocal(true);
      return;
    }
    travado.current = true;
    tentativa.current = atual;
    lance.mutate(atual);
  }

  function aoEnviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (travado.current) return;
    const valorCentavos = reaisParaCentavosDoLance(valorDoCampo);
    if (valorCentavos === null) {
      setErroDoCampo(TEXTO_VALOR_INVALIDO);
      entrada.current?.focus();
      return;
    }
    setErroDoCampo(null);
    enviar(valorCentavos);
  }

  function aoDarLanceMinimo() {
    setErroDoCampo(null);
    setEditado(null);
    enviar(minimo);
  }

  const erro = lance.error;
  const textoDoErro = erro ? textoDaRecusa(erro, lote) : null;
  const mensagemDeErro = erroDoCampo ?? (falhaLocal ? mensagemDoErro('INDISPONIVEL') : textoDoErro);
  const comSaldoInsuficiente = erro instanceof ErroDaApi && erro.codigo === 'SALDO_INSUFICIENTE';
  const incerto = erro instanceof ErroDaApi && erro.resultadoIncerto;
  const enviando = lance.isPending;

  const descricao = ['lance-ajuda', mensagemDeErro ? 'lance-erro' : null].filter(Boolean).join(' ');

  return (
    <form
      noValidate
      onSubmit={aoEnviar}
      className="flex flex-col gap-3 border-t border-borda pt-4"
      aria-label="Dar lance"
    >
      <div>
        <label htmlFor="lance-valor" className="rotulo">
          Valor do lance (R$)
        </label>
        <input
          ref={entrada}
          id="lance-valor"
          name="valor"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valorDoCampo}
          disabled={reconectando}
          readOnly={enviando}
          aria-invalid={mensagemDeErro ? true : undefined}
          aria-describedby={descricao}
          onChange={(e) => {
            setErroDoCampo(null);
            setFalhaLocal(false);
            setEditado(e.target.value);
            lance.reset();
          }}
          className="controle mt-1.5 block min-h-12 text-lg font-bold tabular-nums aria-invalid:border-perigo aria-invalid:ring-1 aria-invalid:ring-perigo"
        />
        <p id="lance-ajuda" className="mt-1.5 text-sm text-texto-suave">
          Lance mínimo: {formatarCentavos(minimo)}
        </p>
        {mensagemDeErro ? (
          <p
            id="lance-erro"
            role="alert"
            className="mt-2 rounded-xl border border-perigo bg-perigo/10 p-3 text-sm font-semibold text-perigo"
          >
            {mensagemDeErro}
            {comSaldoInsuficiente ? (
              <>
                {' '}
                <Link to="/carteira">Ir para a carteira</Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="submit"
          disabled={enviando || reconectando}
          className="botao-primario min-h-12"
        >
          {enviando ? 'Enviando…' : incerto ? 'Tentar de novo' : 'Dar lance'}
        </button>
        <button
          type="button"
          disabled={enviando || reconectando}
          onClick={aoDarLanceMinimo}
          className="botao-secundario min-h-12"
        >
          Dar lance mínimo ({formatarCentavos(minimo)})
        </button>
      </div>
      {/* Sempre montado: leitores de tela só anunciam mudança em região que já existia. */}
      <p role="status" className="font-semibold text-sucesso">
        {registrado}
      </p>
    </form>
  );
}

function textoDaRecusa(erro: unknown, lote: LoteDoEstado): string {
  if (!(erro instanceof ErroDaApi)) return mensagemDoErro('INDISPONIVEL');
  const contexto: ContextoDaMensagem = { inicio: lote.inicioEm };
  const minimo = numeroDe(erro.detalhes, 'minimoCentavos');
  const disponivel = numeroDe(erro.detalhes, 'disponivelCentavos');
  if (minimo !== undefined) contexto.minimoCentavos = minimo;
  if (disponivel !== undefined) contexto.disponivelCentavos = disponivel;
  if (erro.retryAfterSegundos !== undefined) contexto.segundos = erro.retryAfterSegundos;
  return mensagemDoErro(erro.codigo, contexto);
}

/** Decide o que a sala mostra para lance: formulário (licitante), aviso (leiloeiro, anônimo) ou nada. */
export function AreaDeLance({ lote, aoSincronizar, reconectando }: Props) {
  const { usuario, carregando } = useSessao();
  const { pathname, search } = useLocation();

  if (lote.status !== 'ao_vivo' || carregando) return null;
  if (!usuario) {
    const retorno = encodeURIComponent(`${pathname}${search}`);
    return (
      <p className="aviso flex flex-wrap items-center justify-between gap-3">
        Entre como licitante para dar lances.{' '}
        <Link to={`/entrar?retorno=${retorno}`} className="botao-primario">
          Entrar
        </Link>
      </p>
    );
  }
  if (usuario.papel === 'leiloeiro') {
    return <p className="aviso text-texto-suave">Leiloeiros não podem dar lances.</p>;
  }
  return <Formulario lote={lote} aoSincronizar={aoSincronizar} reconectando={reconectando} />;
}
