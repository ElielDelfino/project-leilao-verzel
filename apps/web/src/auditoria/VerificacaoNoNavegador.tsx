import { useState } from 'react';

import type { Auditoria } from '../api/auditoria';
import { ListaDeProblemas } from './ListaDeProblemas';
import { resultadosConcordam, textoDeContagem } from './problemas';
import { type ResultadoLocal, verificarNoNavegador } from './verificarNoNavegador';

const TEXTO_SEM_CRYPTO =
  'Seu navegador não permite a verificação nesta página. Abra o site por uma conexão segura (HTTPS) e tente de novo.';
const TEXTO_FALHA = 'Não foi possível verificar agora. Tente de novo em instantes.';

interface Props {
  loteId: string;
  auditoria: Auditoria;
}

function Alerta({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-xl border border-aviso bg-aviso/10 p-3 font-semibold text-aviso"
    >
      {children}
    </p>
  );
}

function ResultadoConcluido({
  resultado,
  auditoria,
}: {
  resultado: Extract<ResultadoLocal, { tipo: 'concluida' }>;
  auditoria: Auditoria;
}) {
  const concordam = resultadosConcordam(resultado, auditoria);
  const resumo =
    resultado.veredito === 'integro'
      ? 'Verificação no seu navegador: íntegro. Hashes, assinaturas e selo conferem.'
      : `Verificação no seu navegador: adulterado (${textoDeContagem(resultado.problemas.length)}).`;
  const classeDoResultado =
    resultado.veredito === 'integro'
      ? 'border-sucesso bg-sucesso/10 text-sucesso'
      : 'border-perigo bg-perigo/10 text-perigo';
  return (
    <>
      <p className={`mt-3 rounded-xl border p-3 font-semibold ${classeDoResultado}`}>
        <span aria-hidden="true">{resultado.veredito === 'integro' ? '✔' : '⚠'} </span>
        {resumo}
      </p>
      <ListaDeProblemas
        titulo="Problemas encontrados no seu navegador"
        problemas={resultado.problemas}
      />
      {concordam ? (
        <p className="mt-3 text-texto-suave">
          O resultado do seu navegador é igual ao do servidor.
        </p>
      ) : (
        <Alerta>Atenção: o resultado do seu navegador é diferente do resultado do servidor.</Alerta>
      )}
      {resultado.keyIdsUsados.length > 0 ? (
        <p className="mt-3 text-sm break-words text-texto-suave">
          Chave pública usada na verificação: {resultado.keyIdsUsados.join(', ')}. O servidor
          publica esta chave; para ter certeza de que é a verdadeira, compare este código com o
          publicado fora do servidor (README do projeto e página da versão).
        </p>
      ) : null}
    </>
  );
}

function Resultado({
  resultado,
  auditoria,
}: {
  resultado: ResultadoLocal | null;
  auditoria: Auditoria;
}) {
  if (resultado === null) return null;
  if (resultado.tipo === 'sem-crypto') return <Alerta>{TEXTO_SEM_CRYPTO}</Alerta>;
  if (resultado.tipo === 'falha') return <Alerta>{TEXTO_FALHA}</Alerta>;
  return <ResultadoConcluido resultado={resultado} auditoria={auditoria} />;
}

/** Botão e resultado da verificação local (specs/012 §Auditoria). A região existe desde o início. */
export function VerificacaoNoNavegador({ loteId, auditoria }: Props) {
  const [verificando, setVerificando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLocal | null>(null);

  async function verificar() {
    setVerificando(true);
    setResultado(null);
    try {
      setResultado(await verificarNoNavegador(loteId, auditoria));
    } finally {
      setVerificando(false);
    }
  }

  return (
    <section aria-labelledby="titulo-verificacao" className="cartao mt-6 p-5">
      <h2 id="titulo-verificacao" className="text-lg font-bold">
        Verificação no navegador
      </h2>
      <p className="mt-2">
        <button
          type="button"
          disabled={verificando}
          onClick={() => void verificar()}
          className="botao-primario"
        >
          {verificando ? 'Verificando…' : 'Verificar no meu navegador'}
        </button>
      </p>
      <div role="status" aria-live="polite">
        <Resultado resultado={resultado} auditoria={auditoria} />
      </div>
    </section>
  );
}
