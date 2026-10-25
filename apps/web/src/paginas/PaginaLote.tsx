import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { ErroDaApi } from '../api/erro';
import { obterLote } from '../api/lotes';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { tituloDaPagina } from '../layout/site';
import { mensagemDoErro } from '../mensagens/erros';
import { Sala } from '../sala/Sala';
import { useSalaAoVivo } from '../sala/useSalaAoVivo';

const TITULO_NAO_ENCONTRADO = 'Lote não encontrado';

const VoltarAVitrine = () => (
  <p className="mt-8">
    <Link to="/">Voltar à vitrine</Link>
  </p>
);

const TEXTO_SALA_CHEIA = 'Esta sala está cheia agora. Tente de novo em instantes.';

function BotaoTentarDeNovo({ aoClicar }: { aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="min-h-11 rounded-md border border-borda-controle px-4 font-medium"
    >
      Tentar de novo
    </button>
  );
}

/** O `key` recria a sala ao trocar de lote: nenhum dado de um lote aparece sob a carta de outro. */
export function PaginaLote() {
  const { id = '' } = useParams();
  return <SalaDoLote key={id} id={id} />;
}

function SalaDoLote({ id }: { id: string }) {
  const consulta = useQuery({
    queryKey: ['lotes', 'detalhe', id],
    queryFn: () => obterLote(id),
    retry: false,
  });
  const salaAoVivo = useSalaAoVivo(id);

  const naoEncontrado =
    (consulta.error instanceof ErroDaApi && consulta.error.status === 404) ||
    salaAoVivo.erro === 'NAO_ENCONTRADO';
  // Com a sala já aberta, erro de refetch ou de resync vira aviso, não tela de erro.
  const bloqueiaPorConsulta = consulta.error !== null && !consulta.data;
  const bloqueiaPorSala = salaAoVivo.erro !== null && salaAoVivo.estado === null;

  if (bloqueiaPorConsulta || bloqueiaPorSala) {
    if (naoEncontrado) {
      return (
        <>
          <title>{tituloDaPagina(TITULO_NAO_ENCONTRADO)}</title>
          <h1 className="text-3xl font-bold tracking-tight">{TITULO_NAO_ENCONTRADO}</h1>
          <p className="mt-4">{mensagemDoErro('NAO_ENCONTRADO')}</p>
          <VoltarAVitrine />
        </>
      );
    }
    const tentarDeNovo = () => {
      if (consulta.error) void consulta.refetch();
      salaAoVivo.tentarDeNovo();
    };
    return (
      <>
        <title>{tituloDaPagina('Lote')}</title>
        <h1 className="text-3xl font-bold tracking-tight">Lote</h1>
        <div className="mt-4 flex flex-col items-start gap-4">
          {salaAoVivo.erro === 'SALA_CHEIA' && !bloqueiaPorConsulta ? (
            <p role="alert" className="rounded-md border border-borda-controle p-3 font-medium">
              {TEXTO_SALA_CHEIA}
            </p>
          ) : consulta.error ? (
            <ErroDoServidor erro={consulta.error} />
          ) : (
            <p role="alert" className="rounded-md border border-borda-controle p-3 font-medium">
              {mensagemDoErro(
                salaAoVivo.erro === 'DADOS_INVALIDOS' ? 'DADOS_INVALIDOS' : 'INDISPONIVEL',
              )}
            </p>
          )}
          <BotaoTentarDeNovo aoClicar={tentarDeNovo} />
        </div>
        <VoltarAVitrine />
      </>
    );
  }

  if (!consulta.data || !salaAoVivo.estado) {
    return (
      <>
        <title>{tituloDaPagina('Lote')}</title>
        <p role="status">{salaAoVivo.reconectando ? 'Reconectando…' : 'Carregando sala…'}</p>
      </>
    );
  }

  const semConexaoOuComErro =
    salaAoVivo.reconectando || salaAoVivo.erro !== null || consulta.error !== null;

  return (
    <>
      <title>{tituloDaPagina(consulta.data.titulo)}</title>
      <Sala
        detalhe={consulta.data}
        sala={salaAoVivo.estado}
        reconectando={semConexaoOuComErro}
        seloDeFimEstendido={salaAoVivo.seloDeFimEstendido}
      />
      <VoltarAVitrine />
    </>
  );
}
