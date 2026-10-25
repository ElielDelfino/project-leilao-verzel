import { describe, expect, it } from 'vitest';

import { mensagemDoErro, rotuloDoLancamento } from '../../src/mensagens/erros';

const NBSP = ' ';

describe('mensagemDoErro', () => {
  it.each([
    ['PAPEL_NAO_PERMITIDO', {}, 'Sua conta não tem permissão para esta ação.'],
    ['SESSAO_EXPIRADA', {}, 'Sua sessão expirou. Entre novamente.'],
    ['MUITAS_TENTATIVAS', { segundos: 12 }, 'Muitas tentativas. Tente de novo em 12 s.'],
    ['CREDENCIAIS_INVALIDAS', {}, 'E-mail ou senha incorretos.'],
    ['EMAIL_EM_USO', {}, 'Já existe uma conta com este e-mail.'],
    ['DADOS_INVALIDOS', {}, 'Confira os campos destacados.'],
    [
      'CSRF_INVALIDO',
      {},
      'Não foi possível confirmar o envio. Recarregue a página e tente de novo.',
    ],
    ['NAO_AUTENTICADO', {}, 'Entre para continuar.'],
    ['NAO_ENCONTRADO', {}, 'Não encontramos o que você procurou.'],
    ['INDISPONIVEL', {}, 'O serviço está indisponível agora. Tente de novo em instantes.'],
    [
      'LANCE_ABAIXO_DO_MINIMO',
      { minimoCentavos: 12050 },
      `Seu lance precisa ser de pelo menos R$${NBSP}120,50.`,
    ],
    [
      'SALDO_INSUFICIENTE',
      { disponivelCentavos: 500 },
      `Saldo disponível insuficiente: você tem R$${NBSP}5,00.`,
    ],
    ['JA_ESTA_GANHANDO', {}, 'Você já está ganhando este lote.'],
    [
      'LOTE_NAO_INICIADO',
      { inicio: '2026-10-24T13:00:00Z' },
      'Este lote ainda não começou. Abre em 24/10/2026, 10:00.',
    ],
    ['LOTE_ENCERRADO', {}, 'Este lote já foi encerrado.'],
  ] as const)('%s', (codigo, contexto, esperado) => {
    expect(mensagemDoErro(codigo, contexto)).toBe(esperado);
  });

  it('usa a mensagem de indisponível para código sem texto na spec', () => {
    expect(mensagemDoErro('LEILOEIRO_NAO_PODE_LANCAR')).toBe(mensagemDoErro('INDISPONIVEL'));
  });

  it.each([
    ['CATALOGO_OCUPADO', 1, 'A busca de cartas está ocupada. Tente de novo em 1 s.'],
    [
      'CATALOGO_INDISPONIVEL',
      30,
      'A busca de cartas está indisponível agora. Tente de novo em 30 s.',
    ],
  ] as const)('%s com {segundos}', (codigo, segundos, esperado) => {
    expect(mensagemDoErro(codigo, { segundos })).toBe(esperado);
  });

  it.each([
    ['CATALOGO_OCUPADO', 'A busca de cartas está ocupada. Tente de novo em instantes.'],
    [
      'CATALOGO_INDISPONIVEL',
      'A busca de cartas está indisponível agora. Tente de novo em instantes.',
    ],
  ] as const)('%s sem segundos não mostra "undefined"', (codigo, esperado) => {
    expect(mensagemDoErro(codigo)).toBe(esperado);
  });

  it('MUITAS_TENTATIVAS sem segundos não mostra "undefined"', () => {
    expect(mensagemDoErro('MUITAS_TENTATIVAS')).not.toContain('undefined');
  });
});

describe('rotuloDoLancamento', () => {
  it.each([
    ['deposito', 'Depósito'],
    ['compromisso', 'Valor reservado para lance'],
    ['liberacao', 'Valor liberado (lance superado)'],
    ['estorno', 'Estorno de lote cancelado'],
    ['debito_arremate', 'Pagamento de arremate'],
    ['credito_arremate', 'Recebimento de arremate'],
  ] as const)('%s', (tipo, rotulo) => {
    expect(rotuloDoLancamento(tipo)).toBe(rotulo);
  });
});
