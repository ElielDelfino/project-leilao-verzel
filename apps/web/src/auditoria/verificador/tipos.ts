// Tipos da verificação no navegador (specs/008 §Verificação). Os códigos e a ordem são os do servidor.

export type CodigoDoProblema =
  | 'SEQ_FORA_DE_ORDEM'
  | 'HASH_ANTERIOR_DIVERGENTE'
  | 'HASH_DIVERGENTE'
  | 'ASSINATURA_INVALIDA'
  | 'CHAVE_DESCONHECIDA'
  | 'SELO_TOTAL_DIVERGENTE'
  | 'SELO_HASH_FINAL_DIVERGENTE'
  | 'SELO_ASSINATURA_INVALIDA';

/** Problema encontrado; `seq` é `null` nos problemas do selo. */
export interface Problema {
  readonly codigo: CodigoDoProblema;
  readonly seq: number | null;
  readonly mensagem: string;
}

/** Lance como publicado em `GET /api/auditoria/lotes/{id}`. */
export interface LanceDaCadeia {
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: string;
  readonly hashAnterior: string;
  readonly hash: string;
  readonly assinatura: string;
  readonly keyId: string;
}

/** Selo como publicado na auditoria. */
export interface SeloDoLote {
  readonly status: 'encerrado' | 'cancelado';
  readonly totalLances: number;
  readonly hashFinal: string;
  readonly vencedorPseudonimo: string | null;
  readonly valorArremateCentavos: number | null;
  readonly seladoEm: string;
  readonly assinatura: string;
  readonly keyId: string;
}

/** Chave como publicada em `GET /api/auditoria/chaves` (`chavePublica` em base64url). */
export interface ChavePublicada {
  readonly keyId: string;
  readonly chavePublica: string;
}

export interface EntradaDaVerificacao {
  readonly loteId: string;
  /** Lances na ordem publicada (por `seq` crescente). */
  readonly lances: readonly LanceDaCadeia[];
  readonly selo: SeloDoLote | null;
  readonly chaves: readonly ChavePublicada[];
  /**
   * Só `true` na segunda tentativa, depois de a UI refazer a consulta de chaves uma vez
   * (specs/008): aí um `keyId` ausente vira `CHAVE_DESCONHECIDA`.
   */
  readonly chavesAtualizadas?: boolean;
}

export interface ResultadoDaVerificacao {
  readonly tipo: 'concluida';
  readonly veredito: 'integro' | 'adulterado';
  readonly problemas: readonly Problema[];
  /** `keyId` das chaves publicadas que assinaram a cadeia e o selo (para a tela mostrar). */
  readonly keyIdsUsados: readonly string[];
}

/** Há `keyId` fora da lista: a UI refaz a consulta de chaves uma vez e chama de novo. */
export interface PendenciaDeChaves {
  readonly tipo: 'pendente';
  readonly keyIdsAusentes: readonly string[];
}

/** Retorno de `verificarCadeia`: veredito ou pendência de chaves. */
export type RetornoDaVerificacao = ResultadoDaVerificacao | PendenciaDeChaves;

/** O contexto não tem `crypto.subtle` (página fora de HTTPS): sem veredito. */
export class ErroDeContextoInseguro extends Error {
  constructor() {
    super('crypto.subtle indisponível neste contexto');
    this.name = 'ErroDeContextoInseguro';
  }
}
