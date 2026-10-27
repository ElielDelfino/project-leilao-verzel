import type { Auditoria } from '../api/auditoria';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';

const TAMANHO_DO_HASH_ABREVIADO = 8;

type Lance = Auditoria['lances'][number];

function CelulaDeHash({ lance }: { lance: Lance }) {
  return (
    <details>
      <summary className="min-h-6 cursor-pointer font-mono text-xs">
        {lance.hash.slice(0, TAMANHO_DO_HASH_ABREVIADO)}…
      </summary>
      <p className="break-all">
        <code className="font-mono text-xs">Hash: {lance.hash}</code>
      </p>
      <p className="break-all">
        <code className="font-mono text-xs">Hash anterior: {lance.hashAnterior}</code>
      </p>
      <p className="break-all">
        <code className="font-mono text-xs">Chave: {lance.keyId}</code>
      </p>
      <p className="break-all">
        <code className="font-mono text-xs">Assinatura: {lance.assinatura}</code>
      </p>
    </details>
  );
}

/** Lances pseudonimizados do lote (specs/012 §Auditoria). */
export function TabelaDeLances({ lances }: { lances: Auditoria['lances'] }) {
  return (
    <section aria-labelledby="titulo-lances" className="mt-6">
      <h2 id="titulo-lances" className="text-lg font-bold">
        Lances do lote
      </h2>
      {lances.length === 0 ? (
        <p className="aviso mt-2">Nenhum lance foi registrado neste lote.</p>
      ) : (
        <div className="cartao mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Lances do lote</caption>
              <thead className="bg-poco text-xs tracking-wider text-texto-suave uppercase">
                <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-semibold">
                  <th scope="col">Nº</th>
                  <th scope="col">Licitante</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Horário</th>
                  <th scope="col">Hash</th>
                </tr>
              </thead>
              <tbody>
                {lances.map((lance) => (
                  <tr
                    key={lance.seq}
                    className="border-t border-borda align-top [&>td]:px-3 [&>td]:py-2"
                  >
                    <td>{lance.seq}</td>
                    <td>{lance.pseudonimo}</td>
                    <td className="font-semibold text-destaque tabular-nums">
                      {formatarCentavos(lance.valorCentavos)}
                    </td>
                    <td>{formatarDataHora(lance.criadoEm)}</td>
                    <td>
                      <CelulaDeHash lance={lance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
