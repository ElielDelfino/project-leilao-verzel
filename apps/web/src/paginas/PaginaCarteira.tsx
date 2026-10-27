import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type SubmitEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { depositar, obterExtrato, obterSaldo, type Lancamento } from '../api/carteira';
import { efeitoNoSaldo, valorComSinal, type Efeito } from '../carteira/efeitoNoSaldo';
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
      <div className="cartao p-5">
        <dt className="text-sm font-semibold text-texto-suave">Total</dt>
        <dd className="mt-2 text-3xl font-bold text-texto tabular-nums">
          {formatarCentavos(totalCentavos)}
        </dd>
      </div>
      <div className="cartao p-5">
        <dt className="text-sm font-semibold text-texto-suave">Comprometido</dt>
        <dd className="mt-2 text-3xl font-bold text-aviso tabular-nums">
          {formatarCentavos(comprometidoCentavos)}
        </dd>
      </div>
      <div className="cartao border-destaque/40 p-5">
        <dt className="text-sm font-semibold text-texto-suave">Disponível</dt>
        <dd className="mt-2 text-3xl font-bold text-sucesso tabular-nums">
          {formatarCentavos(disponivelCentavos)}
        </dd>
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
    <form noValidate onSubmit={enviar} className="cartao flex max-w-md flex-col gap-4 p-5 sm:p-6">
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
      <p role="status" className="font-medium text-sucesso">
        {registrado}
      </p>
      <button type="submit" disabled={deposito.isPending} className="botao-primario">
        {deposito.isPending ? 'Depositando…' : incerto ? 'Tentar de novo' : 'Depositar'}
      </button>
    </form>
  );
}

/** Cor + sinal do efeito no saldo: a cor nunca é o único sinal. */
const COR_DO_EFEITO: Record<Efeito, string> = {
  entrada: 'text-sucesso',
  devolucao: 'text-sucesso',
  saida: 'text-perigo',
  reserva: 'text-aviso',
};

function ValorDoLancamento({ tipo, valorCentavos }: Pick<Lancamento, 'tipo' | 'valorCentavos'>) {
  const { efeito } = efeitoNoSaldo(tipo);
  return (
    <td
      className={`px-3 py-3 text-right font-bold whitespace-nowrap tabular-nums sm:px-4 ${COR_DO_EFEITO[efeito]}`}
    >
      {valorComSinal(tipo, valorCentavos)}
    </td>
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

  if (lancamentos.length === 0) return <p className="aviso">Nenhum lançamento ainda.</p>;
  return (
    <>
      <div className="cartao overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Lançamentos da carteira</caption>
          <thead className="bg-poco text-xs tracking-wider text-texto-suave uppercase">
            <tr>
              <th scope="col" className="px-3 py-3 sm:px-4 font-semibold">
                Data
              </th>
              <th scope="col" className="px-3 py-3 sm:px-4 font-semibold">
                Lançamento
              </th>
              <th scope="col" className="px-3 py-3 sm:px-4 text-right font-semibold">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {lancamentos.map((l) => (
              <tr key={l.id} className="border-t border-borda">
                <td className="px-3 py-3 sm:px-4 text-texto-suave">
                  {formatarDataHora(l.criadoEm)}
                </td>
                <td className="px-3 py-3 sm:px-4">{rotuloDoLancamento(l.tipo)}</td>
                <ValorDoLancamento tipo={l.tipo} valorCentavos={l.valorCentavos} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <h1 className="titulo-pagina">{TITULO}</h1>
      <section aria-labelledby="saldo-titulo" className="mt-6">
        <h2 id="saldo-titulo" className="sr-only">
          Saldo
        </h2>
        <Saldo />
      </section>
      <section aria-labelledby="deposito-titulo" className="mt-8">
        <h2 id="deposito-titulo" className="mb-4 text-lg font-bold">
          Depositar
        </h2>
        <Deposito />
      </section>
      <section aria-labelledby="extrato-titulo" className="mt-8">
        <h2 id="extrato-titulo" className="mb-4 text-lg font-bold">
          Extrato
        </h2>
        <Extrato />
      </section>
    </>
  );
}
