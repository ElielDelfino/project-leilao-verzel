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
    <p role="alert" className="mt-2 rounded-md border border-borda-controle p-3 font-medium">
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
  return (
    <>
      <p className="mt-2 rounded-md border border-borda-controle p-3 font-medium">
        <span aria-hidden="true">{resultado.veredito === 'integro' ? '✔' : '⚠'} </span>
        {resumo}
      </p>
      <ListaDeProblemas
        titulo="Problemas encontrados no seu navegador"
        problemas={resultado.problemas}
      />
      {concordam ? (
        <p className="mt-2">O resultado do seu navegador é igual ao do servidor.</p>
      ) : (
        <Alerta>Atenção: o resultado do seu navegador é diferente do resultado do servidor.</Alerta>
      )}
      {resultado.keyIdsUsados.length > 0 ? (
        <p className="mt-2 break-words">
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
    <section aria-labelledby="titulo-verificacao" className="mt-6">
      <h2 id="titulo-verificacao" className="text-xl font-bold">
        Verificação no navegador
      </h2>
      <p className="mt-2">
        <button
          type="button"
          disabled={verificando}
          onClick={() => void verificar()}
          className="min-h-11 rounded-md border border-primario bg-primario px-4 font-medium text-texto-sobre-primario disabled:opacity-70"
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
