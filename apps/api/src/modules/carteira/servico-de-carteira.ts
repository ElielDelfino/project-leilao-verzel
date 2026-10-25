// Regras da carteira na F1 (specs/004): saldo, depósito idempotente e extrato. O controller já
// passou por CSRF, autenticação, papel e validação (ADR 0027, D9); aqui fica a regra de negócio.
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';

import { ErroApi } from '../../common/erros/erro-api.js';
import { BANCO } from '../../config/banco.module.js';
import { type BancoVerificavel, ErroDoBanco } from '../../db/banco.js';
import { efeitoDoLancamento, type SaldoEmCentavos } from './efeito.js';
import {
  atualizarSaldo,
  buscarPorChave,
  contarLancamentos,
  inserirLancamento,
  lerSaldo,
  type LinhaDeLancamento,
  listarLancamentos,
  travarSaldo,
} from './repositorio.js';

type Saldo = SchemasApi['Saldo'];
type Lancamento = SchemasApi['Lancamento'];
type MetaPaginacao = SchemasApi['MetaPaginacao'];

/** Lançamentos por página do extrato (specs/004 RF-04). */
export const LANCAMENTOS_POR_PAGINA = 20;

/** Restrição UNIQUE (user_id, idempotency_key) de ledger_entries (migration 0001). */
const RESTRICAO_DA_CHAVE = 'ledger_entries_user_id_idempotency_key_unique';
const VIOLACAO_DE_UNICIDADE = '23505';

export interface ResultadoDoDeposito {
  /** true: lançamento novo (201); false: repetição da mesma chave e corpo (200). */
  readonly criado: boolean;
  readonly lancamento: Lancamento;
  readonly saldo: Saldo;
}

export interface PaginaDoExtrato {
  readonly dados: readonly Lancamento[];
  readonly meta: MetaPaginacao;
}

function paraSaldo(saldo: SaldoEmCentavos): Saldo {
  return {
    totalCentavos: saldo.total,
    comprometidoCentavos: saldo.comprometido,
    disponivelCentavos: saldo.total - saldo.comprometido,
  };
}

function paraLancamento(linha: LinhaDeLancamento): Lancamento {
  return {
    id: linha.id,
    tipo: linha.tipo,
    valorCentavos: linha.valorCentavos,
    loteId: linha.loteId,
    criadoEm: linha.criadoEm.toISOString(),
  };
}

function erroChaveComOutroCorpo(): ErroApi {
  return new ErroApi({
    codigo: 'DADOS_INVALIDOS',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    mensagem: 'Idempotency-Key já usada com outro valor.',
  });
}

function ehChaveRepetida(erro: unknown): boolean {
  return (
    erro instanceof ErroDoBanco &&
    erro.codigo === VIOLACAO_DE_UNICIDADE &&
    erro.restricao === RESTRICAO_DA_CHAVE
  );
}

@Injectable()
export class ServicoDeCarteira {
  constructor(@Inject(BANCO) private readonly banco: BancoVerificavel) {}

  async saldo(userId: string): Promise<Saldo> {
    return paraSaldo(await this.banco.consultar((db) => lerSaldo(db, userId)));
  }

  /**
   * Depósito numa transação (specs/004): cria e trava a linha de wallet_balances, procura a chave
   * já sob a trava (requisições do mesmo usuário ficam em fila) e só então grava o lançamento e
   * atualiza a projeção. A unique (user_id, idempotency_key) é a última defesa: um 23505 nela
   * repete a operação uma vez, que então encontra o lançamento já gravado.
   */
  async depositar(
    userId: string,
    chave: string,
    valorCentavos: number,
  ): Promise<ResultadoDoDeposito> {
    try {
      return await this.depositarNaTransacao(userId, chave, valorCentavos);
    } catch (erro: unknown) {
      if (!ehChaveRepetida(erro)) {
        throw erro;
      }
      return this.depositarNaTransacao(userId, chave, valorCentavos);
    }
  }

  private depositarNaTransacao(
    userId: string,
    chave: string,
    valorCentavos: number,
  ): Promise<ResultadoDoDeposito> {
    return this.banco.transaction(async (tx) => {
      const travado = await travarSaldo(tx, userId);
      const existente = await buscarPorChave(tx, userId, chave);
      if (existente !== undefined) {
        if (existente.tipo !== 'deposito' || existente.valorCentavos !== valorCentavos) {
          throw erroChaveComOutroCorpo();
        }
        return {
          criado: false,
          lancamento: paraLancamento(existente),
          saldo: paraSaldo(travado),
        };
      }
      const lancamento = await inserirLancamento(tx, {
        userId,
        tipo: 'deposito',
        valorCentavos,
        idempotencyKey: chave,
      });
      const saldo = await atualizarSaldo(tx, userId, efeitoDoLancamento('deposito', valorCentavos));
      return { criado: true, lancamento: paraLancamento(lancamento), saldo: paraSaldo(saldo) };
    });
  }

  /** Página além da última → dados [] com o total real; a validação de `pagina` é do controller. */
  async extrato(userId: string, pagina: number): Promise<PaginaDoExtrato> {
    const deslocamento = (pagina - 1) * LANCAMENTOS_POR_PAGINA;
    return this.banco.consultar(async (db) => {
      // Em sequência: uma conexão do pool por requisição (LIMITES_DO_POOL.max = 10).
      const total = await contarLancamentos(db, userId);
      const linhas = await listarLancamentos(db, userId, {
        limite: LANCAMENTOS_POR_PAGINA,
        deslocamento,
      });
      return {
        dados: linhas.map(paraLancamento),
        meta: { total, pagina, limite: LANCAMENTOS_POR_PAGINA },
      };
    });
  }
}
