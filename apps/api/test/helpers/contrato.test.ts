// Testes do validador de contrato (task 041, specs/013 §Contratos): provam que ele aceita uma
// resposta fiel ao openapi.yaml e falha em cada desvio que o critério de aceite lista.
import { describe, expect, it } from 'vitest';

import { validarContrato } from './contrato.js';

const USUARIO = {
  id: '3f0c1d9e-2b7a-4c55-9d1e-0a1b2c3d4e5f',
  nome: 'Ana Souza',
  email: 'ana@exemplo.com',
  papel: 'licitante',
};

function cadastro(sobrescrita: {
  status?: number;
  headers?: Record<string, string>;
  corpo?: unknown;
}) {
  return {
    metodo: 'post',
    caminho: '/api/auth/cadastro',
    status: 201,
    headers: {},
    corpo: { sucesso: true, dados: { usuario: USUARIO } },
    ...sobrescrita,
  };
}

const ERRO_429 = {
  sucesso: false,
  erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas.' },
};

describe('validarContrato', () => {
  it('aceita o 201 de um cadastro válido', () => {
    expect(() => validarContrato(cadastro({}))).not.toThrow();
  });

  it('falha com um campo a mais no corpo', () => {
    const corpo = { sucesso: true, dados: { usuario: { ...USUARIO, senhaHash: 'x' } } };
    expect(() => validarContrato(cadastro({ corpo }))).toThrow(/senhaHash/);
  });

  it('falha com papel fora do enum', () => {
    const corpo = { sucesso: true, dados: { usuario: { ...USUARIO, papel: 'admin' } } };
    expect(() => validarContrato(cadastro({ corpo }))).toThrow(/papel/);
  });

  it('falha em 429 sem Retry-After', () => {
    const entrada = cadastro({ status: 429, corpo: ERRO_429 });
    expect(() => validarContrato(entrada)).toThrow(/Retry-After/);
  });

  it('aceita 429 com Retry-After inteiro positivo (nome do header sem diferenciar caixa)', () => {
    const entrada = cadastro({ status: 429, headers: { 'retry-after': '30' }, corpo: ERRO_429 });
    expect(() => validarContrato(entrada)).not.toThrow();
  });

  it('falha com Retry-After que não é inteiro positivo', () => {
    const entrada = cadastro({ status: 429, headers: { 'Retry-After': 'logo' }, corpo: ERRO_429 });
    expect(() => validarContrato(entrada)).toThrow(/Retry-After/);
  });

  it('falha para uma operação que não existe no contrato', () => {
    const entrada = { ...cadastro({}), caminho: '/api/nao-existe' };
    expect(() => validarContrato(entrada)).toThrow(/operação/);
  });

  it('falha para um método que a rota não declara', () => {
    const entrada = { ...cadastro({}), metodo: 'delete' };
    expect(() => validarContrato(entrada)).toThrow(/operação/);
  });

  it('passa pelo default um 404 do framework (specs/001 §Erros)', () => {
    const corpo = { sucesso: false, erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Não achei.' } };
    expect(() => validarContrato(cadastro({ status: 404, corpo }))).not.toThrow();
  });

  it('falha em um status não declarado fora dos casos de specs/001 §Erros', () => {
    expect(() => validarContrato(cadastro({ status: 200 }))).toThrow(/status 200/);
  });

  it('falha quando o corpo do default não é o envelope de erro', () => {
    const entrada = cadastro({ status: 500, corpo: { sucesso: false } });
    expect(() => validarContrato(entrada)).toThrow(/erro/);
  });
});
