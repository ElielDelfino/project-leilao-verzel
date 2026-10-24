import { describe, expect, it } from 'vitest';

import { carregarEnv, ErroDeConfiguracao } from '../../src/config/env.js';

describe('carregarEnv (validação do env no boot)', () => {
  it('aceita um env válido e converte a porta para número', () => {
    const env = carregarEnv({ API_PORT: '13000', LOG_LEVEL: 'warn' });

    expect(env).toEqual({ API_PORT: 13000, LOG_LEVEL: 'warn' });
  });

  it('usa LOG_LEVEL=info quando ausente', () => {
    const env = carregarEnv({ API_PORT: '13000' });

    expect(env.LOG_LEVEL).toBe('info');
  });

  it('ignora variáveis que não estão no esquema', () => {
    const env = carregarEnv({ API_PORT: '13000', OUTRA: 'x' });

    expect(env).not.toHaveProperty('OUTRA');
  });

  it('falha rápido quando API_PORT está ausente, citando o nome da variável', () => {
    expect(() => carregarEnv({})).toThrow(ErroDeConfiguracao);
    expect(() => carregarEnv({})).toThrow(/API_PORT/);
  });

  it.each(['0', '65536', '13000.5', 'abc', ''])('recusa API_PORT=%j', (valor) => {
    expect(() => carregarEnv({ API_PORT: valor })).toThrow(ErroDeConfiguracao);
  });

  it('recusa LOG_LEVEL fora da lista do Pino', () => {
    expect(() => carregarEnv({ API_PORT: '13000', LOG_LEVEL: 'barulhento' })).toThrow(/LOG_LEVEL/);
  });

  it('não vaza o valor recebido na mensagem de erro', () => {
    const valorSensivel = 'segredo-que-nao-pode-aparecer-123';

    let mensagem = '';
    try {
      carregarEnv({ API_PORT: valorSensivel, LOG_LEVEL: valorSensivel });
    } catch (erro) {
      mensagem = erro instanceof Error ? erro.message : String(erro);
    }

    expect(mensagem).toMatch(/API_PORT/);
    expect(mensagem).toMatch(/LOG_LEVEL/);
    expect(mensagem).not.toContain(valorSensivel);
  });
});
