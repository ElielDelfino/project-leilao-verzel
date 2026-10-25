import { ErroDaApi } from '../api/erro';
import { mensagemDoErro } from '../mensagens/erros';

type Props = { erro: unknown };

/** Texto do mapa código → mensagem; qualquer erro desconhecido vira "indisponível". */
export function textoDoErro(erro: unknown): string {
  if (!(erro instanceof ErroDaApi)) return mensagemDoErro('INDISPONIVEL');
  return mensagemDoErro(
    erro.codigo,
    erro.retryAfterSegundos === undefined ? {} : { segundos: erro.retryAfterSegundos },
  );
}

export function ErroDoServidor({ erro }: Props) {
  return (
    <p role="alert" className="rounded-md border border-borda-controle p-3 font-medium">
      {textoDoErro(erro)}
    </p>
  );
}
