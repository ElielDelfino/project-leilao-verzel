import type { Auditoria } from '../api/auditoria';
import { textoDeContagem } from './problemas';

/** Veredito do servidor com ícone **e** texto (nunca só cor). */
export function VereditoDoServidor({ auditoria }: { auditoria: Auditoria }) {
  const integro = auditoria.veredito === 'integro';
  const texto = integro
    ? 'Íntegro: o servidor não encontrou adulteração.'
    : `Adulterado: o servidor encontrou ${textoDeContagem(auditoria.problemas.length)}.`;
  return (
    <section aria-labelledby="titulo-veredito" className="mt-6">
      <h2 id="titulo-veredito" className="text-xl font-bold">
        Veredito do servidor
      </h2>
      <p className="mt-2 rounded-md border border-borda-controle p-3 font-medium">
        <span aria-hidden="true">{integro ? '✔' : '⚠'} </span>
        {texto}
      </p>
    </section>
  );
}
