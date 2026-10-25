import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';

import { criarLote, type CartaDaBusca } from '../api/catalogo';
import type { Lote } from '../api/lotes';
import { Campo } from '../formularios/Campo';
import { focarPrimeiroInvalido } from '../formularios/validacao';
import { Miniatura } from './Miniatura';
import { campoDoErro, textoDoErroDoCatalogo } from './mensagensDoCatalogo';
import { CAMPOS_DO_LOTE, validarLote, type ErrosDoLote } from './validacao';

interface Props {
  carta: CartaDaBusca;
  aoTrocarCarta: () => void;
  /** 422 com `detalhes.campo` = `scryfallId`: volta ao passo 1 com o aviso. */
  aoRecusarCarta: (mensagem: string) => void;
  aoCriar: (lote: Lote) => void;
}

const CLASSE_ENTRADA =
  'mt-1 block min-h-11 w-full rounded-md border border-borda-controle bg-superficie px-3 text-texto';

/** Passo 2 de specs/012 §Novo lote: dados do lote. */
export function PassoDados({ carta, aoTrocarCarta, aoRecusarCarta, aoCriar }: Props) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [lanceInicial, setLanceInicial] = useState('');
  const [incremento, setIncremento] = useState('');
  const [comecarAgora, setComecarAgora] = useState(true);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [erros, setErros] = useState<ErrosDoLote>({});

  const criacao = useMutation({
    mutationFn: criarLote,
    onSuccess: aoCriar,
    onError: (erro) => {
      if (campoDoErro(erro) === 'scryfallId') aoRecusarCarta(textoDoErroDoCatalogo(erro));
    },
  });

  function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (criacao.isPending) return;
    const formulario = evento.currentTarget;
    const resultado = validarLote(
      {
        scryfallId: carta.scryfallId,
        titulo,
        descricao,
        lanceInicial,
        incremento,
        comecarAgora,
        inicio,
        fim,
      },
      new Date(),
    );
    if (!resultado.ok) {
      setErros(resultado.erros);
      focarPrimeiroInvalido(formulario, CAMPOS_DO_LOTE, resultado.erros);
      return;
    }
    setErros({});
    criacao.mutate(resultado.entrada);
  }

  const erroDoServidor =
    criacao.error && campoDoErro(criacao.error) !== 'scryfallId'
      ? textoDoErroDoCatalogo(criacao.error)
      : null;

  return (
    <>
      <h2 tabIndex={-1} data-foco-do-passo className="mt-6 text-xl font-semibold">
        Dados do lote
      </h2>
      <div className="mt-4 flex items-center gap-4">
        <Miniatura carta={carta} />
        <p className="font-medium">{carta.nome}</p>
        <button
          type="button"
          onClick={aoTrocarCarta}
          className="min-h-11 rounded-md border border-borda-controle px-4 font-medium"
        >
          Trocar carta
        </button>
      </div>
      <form noValidate onSubmit={enviar} className="mt-6 flex max-w-xl flex-col gap-4">
        {erroDoServidor ? (
          <p role="alert" className="rounded-md border border-borda-controle p-3 font-medium">
            {erroDoServidor}
          </p>
        ) : null}
        <Campo
          nome="titulo"
          rotulo="Título (opcional)"
          maxLength={120}
          ajuda="Se ficar em branco, usamos o nome da carta."
          valor={titulo}
          aoMudar={setTitulo}
        />
        <div>
          <label htmlFor="descricao" className="font-medium">
            Descrição (opcional)
          </label>
          <textarea
            id="descricao"
            name="descricao"
            maxLength={2000}
            rows={4}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className={`${CLASSE_ENTRADA} py-2`}
          />
        </div>
        <Campo
          nome="lanceInicial"
          rotulo="Lance inicial (R$)"
          inputMode="decimal"
          valor={lanceInicial}
          aoMudar={setLanceInicial}
          erro={erros.lanceInicial}
        />
        <Campo
          nome="incremento"
          rotulo="Incremento mínimo (R$)"
          inputMode="decimal"
          valor={incremento}
          aoMudar={setIncremento}
          erro={erros.incremento}
        />
        <div className="flex min-h-11 items-center gap-2">
          <input
            id="comecarAgora"
            name="comecarAgora"
            type="checkbox"
            checked={comecarAgora}
            onChange={(e) => setComecarAgora(e.target.checked)}
            className="h-5 w-5"
          />
          <label htmlFor="comecarAgora" className="font-medium">
            Começar agora
          </label>
        </div>
        <Campo
          nome="inicio"
          rotulo="Início"
          tipo="datetime-local"
          desabilitado={comecarAgora}
          valor={inicio}
          aoMudar={setInicio}
          erro={erros.inicio}
        />
        <Campo
          nome="fim"
          rotulo="Fim"
          tipo="datetime-local"
          valor={fim}
          aoMudar={setFim}
          erro={erros.fim}
        />
        <button
          type="submit"
          disabled={criacao.isPending}
          className="min-h-11 self-start rounded-md bg-primario px-4 font-medium text-texto-sobre-primario"
        >
          {criacao.isPending ? 'Criando…' : 'Criar lote'}
        </button>
      </form>
    </>
  );
}
