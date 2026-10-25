// Auditoria pública no servidor (tarefa 081; specs/008 §Verificação e §Interfaces e contratos,
// specs/011, ADR 0031 D7): cadeia inteira do lote, selo, veredito de `verificarCadeia` e as chaves
// públicas de `signing_keys`. Só leitura. O lote vem da interface pública de `lotes`; nada aqui
// seleciona `licitante_id`, nome ou e-mail, e a resposta é montada campo a campo pelo contrato.
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { ErroApi } from '../../common/erros/erro-api.js';
import { BANCO } from '../../config/banco.module.js';
import type { Banco } from '../../db/banco.js';
import { obterResumos, type ResumoDoLote } from '../lotes/index.js';
import { UUID_DO_LOTE } from './esquemas.js';
import { verificarCadeia } from './integridade/verificacao.js';
import {
  type ChaveLida,
  type LinhaDaCadeia,
  lerSeloDoLote,
  listarCadeiaDoLote,
  listarChavesPublicas,
  type SeloLido,
} from './repositorio.js';

type Auditoria = SchemasApi['Auditoria'];
type LanceDaCadeia = SchemasApi['LanceDaCadeia'];
type SeloDoLote = SchemasApi['SeloDoLote'];
type ChavePublica = SchemasApi['ChavePublica'];

/** Algoritmo de toda chave publicada (specs/008 §Chaves). */
const ALGORITMO = 'Ed25519';

/**
 * Leitura num snapshot só (REPEATABLE READ, somente leitura): lote, cadeia, selo e chaves vêm do
 * mesmo instante. Sem isso, um último lance e o selo gravados entre a leitura da cadeia e a do
 * selo dariam `SELO_TOTAL_DIVERGENTE` falso.
 */
const SNAPSHOT_DE_LEITURA = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

function loteNaoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Lote não encontrado.',
  });
}

/** Lote → `LoteDaAuditoria`, campo a campo: `liderId` e `vencedorId` do resumo nunca saem. */
function paraLoteDaAuditoria(resumo: ResumoDoLote): Auditoria['lote'] {
  return {
    id: resumo.id,
    titulo: resumo.titulo,
    cartaNome: resumo.cartaNome,
    status: resumo.status,
    inicioEm: resumo.inicioEm.toISOString(),
    fimEm: resumo.fimEm.toISOString(),
    totalLances: resumo.totalLances,
  };
}

function paraLanceDaCadeia(linha: LinhaDaCadeia): LanceDaCadeia {
  return {
    seq: linha.seq,
    pseudonimo: linha.pseudonimo,
    valorCentavos: linha.valorCentavos,
    criadoEm: linha.criadoEm.toISOString(),
    hashAnterior: linha.hashAnterior,
    hash: linha.hash,
    assinatura: linha.assinatura,
    keyId: linha.keyId,
  };
}

function paraSeloDoLote(selo: SeloLido): SeloDoLote {
  return {
    status: selo.status,
    totalLances: selo.totalLances,
    hashFinal: selo.hashFinal,
    vencedorPseudonimo: selo.vencedorPseudonimo,
    valorArremateCentavos: selo.valorArremateCentavos,
    seladoEm: selo.seladoEm.toISOString(),
    assinatura: selo.assinatura,
    keyId: selo.keyId,
  };
}

function paraChavePublica(chave: ChaveLida): ChavePublica {
  return {
    keyId: chave.keyId,
    algoritmo: ALGORITMO,
    chavePublica: chave.chavePublica.toString('base64url'),
    ativaDesde: chave.ativaDesde.toISOString(),
  };
}

@Injectable()
export class ServicoDeAuditoria {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  /**
   * Auditoria do lote: cadeia inteira por `seq` crescente, selo (ou null) e o veredito recalculado
   * agora, sobre as mesmas linhas devolvidas. Lote inexistente, ou id que não é UUID → 404.
   * O veredito usa os mesmos campos que o navegador recebe (hex e base64url já convertidos).
   */
  async auditoriaDoLote(loteId: string): Promise<Auditoria> {
    if (!UUID_DO_LOTE.test(loteId)) throw loteNaoEncontrado();
    const lido = await this.banco.consultar((db) =>
      db.transaction(async (tx) => {
        const [lote] = await obterResumos(tx, [loteId]);
        if (lote === undefined) throw loteNaoEncontrado();
        // Em sequência: uma conexão por requisição (a transação já a segura).
        const cadeia = await listarCadeiaDoLote(tx, lote.id);
        const selo = await lerSeloDoLote(tx, lote.id);
        const chaves = await listarChavesPublicas(tx);
        return { lote, cadeia, selo, chaves };
      }, SNAPSHOT_DE_LEITURA),
    );
    const lances = lido.cadeia.map(paraLanceDaCadeia);
    const selo = lido.selo === null ? null : paraSeloDoLote(lido.selo);
    // `lote.id` vem do banco (UUID em minúsculas), o formato que a gênese exige.
    const { veredito, problemas } = verificarCadeia({
      loteId: lido.lote.id,
      lances,
      selo,
      chaves: lido.chaves.map((c) => ({ keyId: c.keyId, chavePublica: c.chavePublica })),
    });
    return {
      lote: paraLoteDaAuditoria(lido.lote),
      lances,
      selo,
      veredito,
      problemas: problemas.map((p) => ({ codigo: p.codigo, seq: p.seq, mensagem: p.mensagem })),
    };
  }

  /** Toda chave pública já registrada, por `ativaDesde` crescente (desempate `keyId`). */
  async chavesPublicadas(): Promise<ChavePublica[]> {
    const chaves = await this.banco.consultar((db) => listarChavesPublicas(db));
    return chaves.map(paraChavePublica);
  }
}
