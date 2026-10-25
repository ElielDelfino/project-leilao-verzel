import { Link } from 'react-router';

import type { Comprovante } from '../api/comprovantes';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { CopiarLink } from './CopiarLink';
import { origemDaImagem, rotaDeAuditoria } from './links';

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-texto-suave">{rotulo}</dt>
      <dd className="font-medium break-all">{children}</dd>
    </div>
  );
}

export function DadosDoComprovante({ comprovante }: { comprovante: Comprovante }) {
  const { carta } = comprovante;
  const imagem = origemDaImagem(carta.imagemUrl);
  const auditoria = rotaDeAuditoria(comprovante.auditoriaUrl);

  return (
    <>
      <div className="mt-6 flex flex-col gap-6 sm:flex-row">
        {imagem === null ? (
          <p className="text-texto-suave">Sem imagem</p>
        ) : (
          <img
            src={imagem}
            alt={`Carta ${carta.nome}`}
            width={244}
            height={340}
            className="h-auto max-w-full object-contain"
          />
        )}
        <dl className="grid content-start gap-2">
          <Item rotulo="Carta">{carta.nome}</Item>
          <Item rotulo="Valor do arremate">{formatarCentavos(comprovante.valorCentavos)}</Item>
          <Item rotulo="Arrematado por">{comprovante.vencedorPseudonimo}</Item>
          <Item rotulo="Selado em">{formatarDataHora(comprovante.seladoEm)}</Item>
          <Item rotulo="Emitido em">{formatarDataHora(comprovante.emitidoEm)}</Item>
          <Item rotulo="Hash final">{comprovante.hashFinal}</Item>
          <Item rotulo="Assinatura do selo">{comprovante.assinaturaSelo}</Item>
          <Item rotulo="Chave de assinatura">{comprovante.keyId}</Item>
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
