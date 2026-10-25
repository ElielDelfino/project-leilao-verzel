import type { Auditoria } from '../api/auditoria';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';

const TAMANHO_DO_HASH_ABREVIADO = 8;

type Lance = Auditoria['lances'][number];

function CelulaDeHash({ lance }: { lance: Lance }) {
  return (
    <details>
      <summary className="min-h-6 cursor-pointer">
        {lance.hash.slice(0, TAMANHO_DO_HASH_ABREVIADO)}…
      </summary>
      <p className="break-all">
        <code>Hash: {lance.hash}</code>
      </p>
      <p className="break-all">
        <code>Hash anterior: {lance.hashAnterior}</code>
      </p>
      <p className="break-all">
        <code>Chave: {lance.keyId}</code>
      </p>
      <p className="break-all">
        <code>Assinatura: {lance.assinatura}</code>
      </p>
    </details>
  );
}

/** Lances pseudonimizados do lote (specs/012 §Auditoria). */
export function TabelaDeLances({ lances }: { lances: Auditoria['lances'] }) {
  return (
    <section aria-labelledby="titulo-lances" className="mt-6">
      <h2 id="titulo-lances" className="text-xl font-bold">
        Lances do lote
      </h2>
      {lances.length === 0 ? (
        <p className="mt-2">Nenhum lance foi registrado neste lote.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Lances do lote</caption>
            <thead>
              <tr>
                <th scope="col">Nº</th>
                <th scope="col">Licitante</th>
                <th scope="col">Valor</th>
                <th scope="col">Horário</th>
                <th scope="col">Hash</th>
              </tr>
            </thead>
            <tbody>
              {lances.map((lance) => (
                <tr key={lance.seq} className="border-t border-borda align-top">
                  <td>{lance.seq}</td>
                  <td>{lance.pseudonimo}</td>
                  <td>{formatarCentavos(lance.valorCentavos)}</td>
                  <td>{formatarDataHora(lance.criadoEm)}</td>
                  <td>
                    <CelulaDeHash lance={lance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
