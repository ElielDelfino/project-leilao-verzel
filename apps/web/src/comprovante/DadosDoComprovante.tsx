import { Link } from 'react-router';

import type { Comprovante } from '../api/comprovantes';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { CopiarLink } from './CopiarLink';
import { origemDaImagem, rotaDeAuditoria } from './links';

function Item({
  rotulo,
  children,
  classe = '',
}: {
  rotulo: string;
  children: React.ReactNode;
  classe?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-borda py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-sm text-texto-suave">{rotulo}</dt>
      <dd className={`font-semibold break-all sm:text-right ${classe}`}>{children}</dd>
    </div>
  );
}

export function DadosDoComprovante({ comprovante }: { comprovante: Comprovante }) {
  const { carta } = comprovante;
  const imagem = origemDaImagem(carta.imagemUrl);
  const auditoria = rotaDeAuditoria(comprovante.auditoriaUrl);

  return (
    <>
      <div className="cartao mt-6 flex flex-col gap-6 p-5 sm:flex-row sm:p-6">
        {imagem === null ? (
          <p className="self-start rounded-xl bg-poco p-4 text-texto-suave">Sem imagem</p>
        ) : (
          <img
            src={imagem}
            alt={`Carta ${carta.nome}`}
            width={244}
            height={340}
            className="h-auto max-w-full self-start rounded-xl bg-poco object-contain p-3"
          />
        )}
        <dl className="grid min-w-0 flex-1 content-start">
          <Item rotulo="Carta">{carta.nome}</Item>
          <Item rotulo="Valor do arremate" classe="text-xl text-destaque tabular-nums">
            {formatarCentavos(comprovante.valorCentavos)}
          </Item>
          <Item rotulo="Arrematado por">{comprovante.vencedorPseudonimo}</Item>
          <Item rotulo="Selado em">{formatarDataHora(comprovante.seladoEm)}</Item>
          <Item rotulo="Emitido em">{formatarDataHora(comprovante.emitidoEm)}</Item>
          <Item rotulo="Hash final" classe="font-mono text-xs">
            {comprovante.hashFinal}
          </Item>
          <Item rotulo="Assinatura do selo" classe="font-mono text-xs">
            {comprovante.assinaturaSelo}
          </Item>
          <Item rotulo="Chave de assinatura" classe="font-mono text-xs">
            {comprovante.keyId}
          </Item>
        </dl>
      </div>
      {auditoria === null ? null : (
        <p className="mt-6">
          <Link to={auditoria}>Ver auditoria</Link>
        </p>
      )}
      <CopiarLink codigo={comprovante.codigo} />
    </>
  );
}
