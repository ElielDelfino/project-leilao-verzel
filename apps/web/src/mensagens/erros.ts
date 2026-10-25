import type { SchemasApi } from '@leilao/contracts';

import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';

export type CodigoDeErro = SchemasApi['Erro']['erro']['codigo'];
export type TipoDeLancamento = SchemasApi['TipoLancamento'];

/** Valores que entram nos textos com parâmetro (specs/012 §Comportamento). */
export interface ContextoDaMensagem {
  segundos?: number;
  minimoCentavos?: number;
  disponivelCentavos?: number;
  /** Instante ISO 8601. */
  inicio?: string;
}

const TEXTO_INDISPONIVEL = 'O serviço está indisponível agora. Tente de novo em instantes.';

type Texto = (contexto: ContextoDaMensagem) => string;

// Um único mapa código → mensagem (specs/012 e tarefa 036 D12). Códigos sem texto na spec
// (LEILOEIRO_NAO_PODE_LANCAR, CATALOGO_*) caem no texto de indisponível.
const MENSAGENS: Partial<Record<CodigoDeErro, Texto>> = {
  LANCE_ABAIXO_DO_MINIMO: ({ minimoCentavos }) =>
    `Seu lance precisa ser de pelo menos ${
      minimoCentavos === undefined ? 'o valor mínimo' : formatarCentavos(minimoCentavos)
    }.`,
  SALDO_INSUFICIENTE: ({ disponivelCentavos }) =>
    `Saldo disponível insuficiente: você tem ${
      disponivelCentavos === undefined ? 'menos que o lance' : formatarCentavos(disponivelCentavos)
    }.`,
  JA_ESTA_GANHANDO: () => 'Você já está ganhando este lote.',
  LOTE_NAO_INICIADO: ({ inicio }) =>
    `Este lote ainda não começou.${inicio === undefined ? '' : ` Abre em ${formatarDataHora(inicio)}.`}`,
  LOTE_ENCERRADO: () => 'Este lote já foi encerrado.',
  PAPEL_NAO_PERMITIDO: () => 'Sua conta não tem permissão para esta ação.',
  SESSAO_EXPIRADA: () => 'Sua sessão expirou. Entre novamente.',
  MUITAS_TENTATIVAS: ({ segundos }) =>
    segundos === undefined
      ? 'Muitas tentativas. Tente de novo em instantes.'
      : `Muitas tentativas. Tente de novo em ${segundos} s.`,
  CREDENCIAIS_INVALIDAS: () => 'E-mail ou senha incorretos.',
  EMAIL_EM_USO: () => 'Já existe uma conta com este e-mail.',
  DADOS_INVALIDOS: () => 'Confira os campos destacados.',
  CSRF_INVALIDO: () => 'Não foi possível confirmar o envio. Recarregue a página e tente de novo.',
  NAO_AUTENTICADO: () => 'Entre para continuar.',
  NAO_ENCONTRADO: () => 'Não encontramos o que você procurou.',
  INDISPONIVEL: () => TEXTO_INDISPONIVEL,
};

export function mensagemDoErro(codigo: CodigoDeErro, contexto: ContextoDaMensagem = {}): string {
  return (MENSAGENS[codigo] ?? (() => TEXTO_INDISPONIVEL))(contexto);
}

export const TEXTO_DEPOSITO_INVALIDO = 'Informe um valor entre R$ 1,00 e R$ 100.000,00.';

export function mensagemDeDepositoRegistrado(valorFormatado: string): string {
  return `Depósito de ${valorFormatado} registrado.`;
}

const ROTULOS_DO_EXTRATO: Record<TipoDeLancamento, string> = {
  deposito: 'Depósito',
  compromisso: 'Valor reservado para lance',
  liberacao: 'Valor liberado (lance superado)',
  estorno: 'Estorno de lote cancelado',
  debito_arremate: 'Pagamento de arremate',
  credito_arremate: 'Recebimento de arremate',
};

export function rotuloDoLancamento(tipo: TipoDeLancamento): string {
  return ROTULOS_DO_EXTRATO[tipo];
}
