// Cadeia persistida do lote (specs/008 §Técnica, specs/007 §Transação passo 5): `anexar` grava um
// elo em `bids` e `selar` grava `lot_seals`, ambos na `tx` de quem chama, com o lote já travado
// (FOR UPDATE em `lots`). Hash, canônico e assinatura vêm das funções puras de integridade/.
import { Injectable } from '@nestjs/common';

import type { Transacao } from '../../db/banco.js';
import { ServicoDeChaves } from './chaves.js';
import { hashDoLance, hashDoSelo, hashGenese, type StatusDoSelo } from './integridade/hash.js';
import { inserirLance, inserirSelo, lerUltimoLance } from './repositorio.js';
import { CENTAVOS_MAXIMO_DO_LANCE, CENTAVOS_MINIMO_DO_LANCE } from './schema.js';

/** Dados do lance novo. `criadoEm` é o `agora(tx)` lido uma vez depois do lock do lote. */
export interface NovoLance {
  readonly loteId: string;
  readonly licitanteId: string;
  readonly valorCentavos: number;
  readonly criadoEm: Date;
  readonly idempotencyKey: string;
}

/** Elo gravado: hashes em hex minúsculo, assinatura em base64url, `criadoEm` em ISO com ms. */
export interface LanceAnexado {
  /** UUIDv7 do lance, para o ledger referenciar (FK imediata, ADR 0031 D9). */
  readonly id: string;
  readonly loteId: string;
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: string;
  readonly hashAnterior: string;
  readonly hash: string;
  readonly assinatura: string;
  readonly keyId: string;
  /** Lance de `seq − 1` (o do líder anterior), ou `null` no primeiro lance do lote. */
  readonly lanceAnteriorId: string | null;
}

/** Dados do selo. `seladoEm` é o `agora(tx)` da transação do encerramento ou do cancelamento. */
export interface NovoSelo {
  readonly loteId: string;
  readonly status: StatusDoSelo;
  readonly seladoEm: Date;
}

/** Selo gravado, na forma de specs/008 §Forma canônica, com assinatura e `keyId`. */
export interface SeloGravado {
  readonly loteId: string;
  readonly status: StatusDoSelo;
  readonly totalLances: number;
  readonly hashFinal: string;
  readonly vencedorPseudonimo: string | null;
  readonly valorArremateCentavos: number | null;
  readonly seladoEm: string;
  readonly assinatura: string;
  readonly keyId: string;
}

const UUID_MINUSCULO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Instante em ISO 8601 com ms; um Date já guarda ms inteiros (truncados, nunca arredondados). */
function instante(nome: string, data: Date): string {
  if (Number.isNaN(data.getTime())) throw new RangeError(`${nome} não é um instante válido`);
  return data.toISOString();
}

function validarLance(novo: NovoLance): void {
  // O pseudônimo é HMAC do texto do id: uma grafia diferente daria outro pseudônimo no lote.
  if (!UUID_MINUSCULO.test(novo.licitanteId)) {
    throw new RangeError('licitanteId deve ser UUID em minúsculas');
  }
  const valor = novo.valorCentavos;
  if (
    !Number.isSafeInteger(valor) ||
    valor < CENTAVOS_MINIMO_DO_LANCE ||
    valor > CENTAVOS_MAXIMO_DO_LANCE
  ) {
    throw new RangeError('valorCentavos fora da faixa do lance');
  }
}

@Injectable()
export class CadeiaDeLances {
  constructor(private readonly chaves: ServicoDeChaves) {}

  /**
   * Lê o último lance do lote (ou a gênese), calcula `seq`, `hashAnterior`, `hash` e a
   * assinatura e insere em `bids`. Pré-condição: o lote está travado na `tx` (quem chama), o que
   * mantém a `seq` contígua; o banco não impõe a cadeia. Erro exige rollback da `tx`.
   */
  async anexar(tx: Transacao, novo: NovoLance): Promise<LanceAnexado> {
    validarLance(novo);
    const criadoEm = instante('criadoEm', novo.criadoEm);
    const anterior = await lerUltimoLance(tx, novo.loteId);
    const dados = {
      loteId: novo.loteId,
      seq: (anterior?.seq ?? 0) + 1,
      pseudonimo: this.chaves.pseudonimo(novo.loteId, novo.licitanteId),
      valorCentavos: novo.valorCentavos,
      criadoEm,
      hashAnterior: anterior?.hash ?? hashGenese(novo.loteId),
    };
    const hash = hashDoLance(dados);
    const { assinatura, keyId } = this.chaves.assinar(hash);
    const id = await inserirLance(tx, {
      ...dados,
      licitanteId: novo.licitanteId,
      // O mesmo instante assinado: a coluna timestamptz(3) guarda os ms exatos.
      criadoEm: new Date(criadoEm),
      hash,
      assinatura,
      keyId,
      idempotencyKey: novo.idempotencyKey,
    });
    return { ...dados, id, hash, assinatura, keyId, lanceAnteriorId: anterior?.id ?? null };
  }

  /**
   * Sela o lote com o estado da cadeia na `tx`: `totalLances` e `hashFinal` do último lance (ou
   * 0 e a gênese) e, só em lote encerrado com lance, vencedor e arremate do último lance (o
   * maior). Chamado por `liquidacao` na transação do encerramento ou do cancelamento (specs/010).
   * Pré-condições (quem chama): o lote está travado na `tx` com o mesmo FOR UPDATE do `anexar`,
   * senão o selo pode ler um último lance defasado e gravar total, `hashFinal` e vencedor errados,
   * e o banco não pega; e `status` é `encerrado` só para lote de fato encerrado, porque `selar`
   * não confere o status do lote e daria vencedor num lote aberto.
   */
  async selar(tx: Transacao, novo: NovoSelo): Promise<SeloGravado> {
    const seladoEm = instante('seladoEm', novo.seladoEm);
    const ultimo = await lerUltimoLance(tx, novo.loteId);
    const vencedor = novo.status === 'encerrado' ? ultimo : null;
    const dados = {
      loteId: novo.loteId,
      status: novo.status,
      totalLances: ultimo?.seq ?? 0,
      hashFinal: ultimo?.hash ?? hashGenese(novo.loteId),
      vencedorPseudonimo: vencedor?.pseudonimo ?? null,
      valorArremateCentavos: vencedor?.valorCentavos ?? null,
      seladoEm,
    };
    const { assinatura, keyId } = this.chaves.assinar(hashDoSelo(dados));
    await inserirSelo(tx, { ...dados, seladoEm: new Date(seladoEm), assinatura, keyId });
    return { ...dados, assinatura, keyId };
  }
}
