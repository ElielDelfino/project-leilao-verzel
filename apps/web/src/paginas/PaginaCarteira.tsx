import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type SubmitEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { depositar, obterExtrato, obterSaldo } from '../api/carteira';
import { ErroDaApi } from '../api/erro';
import { Campo } from '../formularios/Campo';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { formatarDataHora } from '../formatacao/data';
import { reaisParaCentavos } from '../formatacao/deposito';
import { formatarCentavos } from '../formatacao/dinheiro';
import { tituloDaPagina } from '../layout/site';
import {
  mensagemDeDepositoRegistrado,
  rotuloDoLancamento,
  TEXTO_DEPOSITO_INVALIDO,
} from '../mensagens/erros';

const TITULO = 'Carteira';
const CHAVE_CARTEIRA = ['carteira'] as const;

function paginaDaUrl(parametro: string | null): number {
  const numero = Number(parametro);
  return Number.isInteger(numero) && numero >= 1 ? numero : 1;
}

function Saldo() {
  const consulta = useQuery({ queryKey: [...CHAVE_CARTEIRA, 'saldo'], queryFn: obterSaldo });
  if (consulta.error) return <ErroDoServidor erro={consulta.error} />;
  if (!consulta.data) return <p role="status">Carregando…</p>;
  const { totalCentavos, comprometidoCentavos, disponivelCentavos } = consulta.data;
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <div>
        <dt className="text-texto-suave">Total</dt>
        <dd className="text-2xl font-bold">{formatarCentavos(totalCentavos)}</dd>
      </div>
      <div>
        <dt className="text-texto-suave">Comprometido</dt>
        <dd className="text-2xl font-bold">{formatarCentavos(comprometidoCentavos)}</dd>
      </div>
      <div>
        <dt className="text-texto-suave">Disponível</dt>
        <dd className="text-2xl font-bold">{formatarCentavos(disponivelCentavos)}</dd>
      </div>
    </dl>
  );
}

function Deposito() {
  const queryClient = useQueryClient();
  const [valor, setValor] = useState('');
  const [erroDoCampo, setErroDoCampo] = useState<string | undefined>();
  const [registrado, setRegistrado] = useState<string | null>(null);
  // Uma chave por envio: o reenvio após falha incerta usa a mesma; editar o valor gera outra.
  const chave = useRef<string | null>(null);
  const campo = useRef<HTMLDivElement>(null);

  const deposito = useMutation({
    mutationFn: ({ centavos, idempotencia }: { centavos: number; idempotencia: string }) =>
      depositar(centavos, idempotencia),
    onSuccess: async (dados) => {
      chave.current = null;
      setValor('');
      setRegistrado(mensagemDeDepositoRegistrado(formatarCentavos(dados.lancamento.valorCentavos)));
      await queryClient.invalidateQueries({ queryKey: CHAVE_CARTEIRA });
    },
    onError: (erro) => {
      // Recusa definitiva: um novo envio é outra operação. Resultado incerto mantém a chave.
      if (!(erro instanceof ErroDaApi) || !erro.resultadoIncerto) chave.current = null;
    },
  });

  function editar(novo: string) {
    // Com envio em voo o campo está desabilitado; nunca troca a chave nem reinicia a mutação.
    if (deposito.isPending) return;
    chave.current = null;
    setValor(novo);
    setRegistrado(null);
    deposito.reset();
  }

  function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    const centavos = reaisParaCentavos(valor);
    if (centavos === null) {
      setErroDoCampo(TEXTO_DEPOSITO_INVALIDO);
      campo.current?.querySelector('input')?.focus();
      return;
    }
    setErroDoCampo(undefined);
    setRegistrado(null);
    chave.current ??= crypto.randomUUID();
    deposito.mutate({ centavos, idempotencia: chave.current });
  }

  const incerto = deposito.error instanceof ErroDaApi && deposito.error.resultadoIncerto;

  return (
    <form noValidate onSubmit={enviar} className="flex max-w-md flex-col gap-4">
      <div ref={campo}>
        <Campo
          nome="valor"
          rotulo="Valor do depósito (R$)"
          inputMode="decimal"
          ajuda="De R$ 1,00 a R$ 100.000,00."
          erro={erroDoCampo}
          desabilitado={deposito.isPending}
          valor={valor}
          aoMudar={(v) => {
            setErroDoCampo(undefined);
            editar(v);
          }}
        />
      </div>
      {deposito.error ? <ErroDoServidor erro={deposito.error} /> : null}
      {/* Sempre montado: leitores de tela só anunciam mudança em região que já existia. */}
      <p role="status" className="font-medium">
        {registrado}
      </p>
      <button
        type="submit"
        disabled={deposito.isPending}
        className="min-h-11 rounded-md bg-primario px-4 font-medium text-texto-sobre-primario"
      >
        {deposito.isPending ? 'Depositando…' : incerto ? 'Tentar de novo' : 'Depositar'}
      </button>
    </form>
  );
}

function Extrato() {
  const [params] = useSearchParams();
  const pagina = paginaDaUrl(params.get('pagina'));
  const consulta = useQuery({
    queryKey: [...CHAVE_CARTEIRA, 'extrato', pagina],
    queryFn: () => obterExtrato(pagina),
  });

  if (consulta.error) return <ErroDoServidor erro={consulta.error} />;
  if (!consulta.data) return <p role="status">Carregando…</p>;
  const { lancamentos, meta } = consulta.data;
  const ultimaPagina = Math.max(1, Math.ceil(meta.total / meta.limite));

  if (lancamentos.length === 0) return <p>Nenhum lançamento ainda.</p>;
  return (
    <>
      <table className="w-full text-left">
        <caption className="sr-only">Lançamentos da carteira</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Lançamento</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {lancamentos.map((l) => (
            <tr key={l.id} className="border-t border-borda">
              <td>{formatarDataHora(l.criadoEm)}</td>
              <td>{rotuloDoLancamento(l.tipo)}</td>
              <td>{formatarCentavos(l.valorCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav aria-label="Paginação do extrato" className="mt-4 flex items-center gap-4">
        {pagina > 1 ? <Link to={`?pagina=${pagina - 1}`}>Anterior</Link> : null}
        <span>
          Página {meta.pagina} de {ultimaPagina}
        </span>
        {pagina < ultimaPagina ? <Link to={`?pagina=${pagina + 1}`}>Próxima</Link> : null}
      </nav>
    </>
  );
}

export function PaginaCarteira() {
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      <section aria-labelledby="saldo-titulo" className="mt-6">
        <h2 id="saldo-titulo" className="sr-only">
          Saldo
        </h2>
        <Saldo />
      </section>
      <section aria-labelledby="deposito-titulo" className="mt-8">
        <h2 id="deposito-titulo" className="mb-4 text-xl font-bold">
          Depositar
        </h2>
        <Deposito />
      </section>
      <section aria-labelledby="extrato-titulo" className="mt-8">
        <h2 id="extrato-titulo" className="mb-4 text-xl font-bold">
          Extrato
        </h2>
        <Extrato />
      </section>
    </>
  );
}
