import { Link } from 'react-router';

import type { Arremate, LanceDoUsuario } from '../api/arremates';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { imagemDoSnapshot, rotaDeAuditoria, rotaDeComprovante, rotaDoLote } from './links';
import { RotuloDePosicao } from './RotuloDePosicao';

const CLASSE_IMAGEM = 'h-24 w-[69px] shrink-0 rounded-md object-cover';
const CLASSE_LINK = 'inline-flex min-h-11 items-center font-medium underline';

function Imagem({ imagemUrl, nomeDaCarta }: { imagemUrl: string; nomeDaCarta: string }) {
  const src = imagemDoSnapshot(imagemUrl);
  if (!src) {
    return (
      <div
        className={`${CLASSE_IMAGEM} flex items-center justify-center bg-superficie text-center text-xs text-texto-suave`}
      >
        Sem imagem
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`Carta ${nomeDaCarta}`}
      width={69}
      height={96}
      loading="lazy"
      className={CLASSE_IMAGEM}
    />
  );
}

export function ItemDeLance({ item }: { item: LanceDoUsuario }) {
  const { lote, posicao, meuMaiorLanceCentavos } = item;
  const rotaDaSala = rotaDoLote(lote.id);
  return (
    <div className="flex gap-4">
      <Imagem imagemUrl={lote.imagemUrl} nomeDaCarta={lote.cartaNome} />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <h2 className="text-lg font-semibold">
          {rotaDaSala ? (
            <Link to={rotaDaSala} className="underline">
              {lote.titulo}
            </Link>
          ) : (
            lote.titulo
          )}
        </h2>
        <RotuloDePosicao posicao={posicao} />
        <p>Seu maior lance: {formatarCentavos(meuMaiorLanceCentavos)}</p>
      </div>
    </div>
  );
}

export function ItemDeArremate({ item }: { item: Arremate }) {
  const { codigo, valorCentavos, carta, emitidoEm, auditoriaUrl } = item;
  const rotaDaAuditoria = rotaDeAuditoria(auditoriaUrl);
  return (
    <div className="flex gap-4">
      <Imagem imagemUrl={carta.imagemUrl} nomeDaCarta={carta.nome} />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <h2 className="text-lg font-semibold">{carta.nome}</h2>
        <p>Valor do arremate: {formatarCentavos(valorCentavos)}</p>
        <p className="text-texto-suave">Emitido em {formatarDataHora(emitidoEm)}</p>
        <div className="flex flex-wrap gap-x-6">
          <Link to={rotaDeComprovante(codigo)} className={CLASSE_LINK}>
            Ver comprovante
            <span className="sr-only">: {carta.nome}</span>
          </Link>
          {rotaDaAuditoria ? (
            <Link to={rotaDaAuditoria} className={CLASSE_LINK}>
              Ver auditoria
              <span className="sr-only">: {carta.nome}</span>
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
