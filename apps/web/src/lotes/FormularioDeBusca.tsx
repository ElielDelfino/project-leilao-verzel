import { useRef, useState, type SubmitEvent } from 'react';

import type { FiltrosDaVitrine, Raridade } from '../api/lotes';
import { Campo } from '../formularios/Campo';
import {
  TEXTO_MAXIMO_MENOR_QUE_MINIMO,
  TEXTO_PRECO_INVALIDO,
  centavosParaTexto,
  precoParaCentavos,
} from './precoEmReais';
import { RARIDADES, ROTULOS_DE_RARIDADE } from './rotulos';

type CamposDeBusca = Pick<FiltrosDaVitrine, 'q' | 'raridade' | 'precoMin' | 'precoMax'>;

interface FormularioDeBuscaProps {
  filtros: FiltrosDaVitrine;
  aoFiltrar: (novos: CamposDeBusca) => void;
  aoLimpar: () => void;
}

interface Erros {
  precoMin?: string;
  precoMax?: string;
}

/** Interpreta o campo de preço: vazio não filtra; mal formado vira `erro`. */
function lerPreco(texto: string): { valor?: number; erro?: string } {
  if (texto.trim() === '') return {};
  const centavos = precoParaCentavos(texto);
  return centavos === null ? { erro: TEXTO_PRECO_INVALIDO } : { valor: centavos };
}

/** Os campos partem da URL; o pai troca a `key` quando os filtros da URL mudam. */
export function FormularioDeBusca({ filtros, aoFiltrar, aoLimpar }: FormularioDeBuscaProps) {
  const [q, setQ] = useState(filtros.q ?? '');
  const [raridade, setRaridade] = useState<Raridade | ''>(filtros.raridade ?? '');
  const [precoMin, setPrecoMin] = useState(
    filtros.precoMin === undefined ? '' : centavosParaTexto(filtros.precoMin),
  );
  const [precoMax, setPrecoMax] = useState(
    filtros.precoMax === undefined ? '' : centavosParaTexto(filtros.precoMax),
  );
  const [erros, setErros] = useState<Erros>({});
  const raiz = useRef<HTMLFormElement>(null);

  function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    const minimo = lerPreco(precoMin);
    const maximo = lerPreco(precoMax);
    const novosErros: Erros = {};
    if (minimo.erro) novosErros.precoMin = minimo.erro;
    if (maximo.erro) novosErros.precoMax = maximo.erro;
    if (
      !novosErros.precoMin &&
      !novosErros.precoMax &&
      minimo.valor !== undefined &&
      maximo.valor !== undefined &&
      maximo.valor < minimo.valor
    ) {
      novosErros.precoMax = TEXTO_MAXIMO_MENOR_QUE_MINIMO;
    }
    setErros(novosErros);
    if (novosErros.precoMin || novosErros.precoMax) {
      const alvo = novosErros.precoMin ? 'precoMin' : 'precoMax';
      raiz.current?.querySelector<HTMLInputElement>(`#${alvo}`)?.focus();
      return;
    }
    const busca = q.trim();
    aoFiltrar({
      q: busca === '' ? undefined : busca,
      raridade: raridade === '' ? undefined : raridade,
      precoMin: minimo.valor,
      precoMax: maximo.valor,
    });
  }

  return (
    <form
      ref={raiz}
      role="search"
      noValidate
      onSubmit={enviar}
      className="cartao grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Campo
        nome="q"
        rotulo="Buscar por título ou carta"
        tipo="search"
        maxLength={100}
        valor={q}
        aoMudar={setQ}
      />
      <div>
        <label htmlFor="raridade" className="rotulo">
          Raridade
        </label>
        <select
          id="raridade"
          name="raridade"
          value={raridade}
          onChange={(e) => setRaridade(e.target.value as Raridade | '')}
          className="controle mt-1.5 block"
        >
          <option value="">Todas</option>
          {RARIDADES.map((r) => (
            <option key={r} value={r}>
              {ROTULOS_DE_RARIDADE[r]}
            </option>
          ))}
        </select>
      </div>
      <Campo
        nome="precoMin"
        rotulo="Preço mínimo (R$)"
        inputMode="decimal"
        valor={precoMin}
        aoMudar={setPrecoMin}
        erro={erros.precoMin}
      />
      <Campo
        nome="precoMax"
        rotulo="Preço máximo (R$)"
        inputMode="decimal"
        valor={precoMax}
        aoMudar={setPrecoMax}
        erro={erros.precoMax}
      />
      <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-4">
        <button type="submit" className="botao-primario">
          Filtrar
        </button>
        <button type="button" onClick={aoLimpar} className="botao-secundario">
          Limpar filtros
        </button>
      </div>
    </form>
  );
}
