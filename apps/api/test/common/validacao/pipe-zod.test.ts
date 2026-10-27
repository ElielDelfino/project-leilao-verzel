// Unidade: pipe de validação Zod (specs/003 §Comportamento: campo desconhecido → 422).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import { PipeZod } from '../../../src/common/validacao/pipe-zod.js';

const esquema = z.strictObject({ nome: z.string().min(2), idade: z.number().int() });

function erroDe(fn: () => unknown): ErroApi {
  try {
    fn();
  } catch (erro) {
    if (erro instanceof ErroApi) {
      return erro;
    }
    throw erro;
  }
  throw new Error('o pipe deveria ter lançado');
}

describe('PipeZod', () => {
  it('devolve o valor já validado (e transformado) pelo esquema', () => {
    const pipe = new PipeZod(z.strictObject({ n: z.string().transform((s) => s.length) }));

    expect(pipe.transform({ n: 'abc' })).toEqual({ n: 3 });
  });

  it('campo desconhecido → 422 DADOS_INVALIDOS', () => {
    const erro = erroDe(() => new PipeZod(esquema).transform({ nome: 'Helena', idade: 3, x: 1 }));

    expect(erro.status).toBe(422);
    expect(erro.codigo).toBe('DADOS_INVALIDOS');
  });

  it.each([undefined, null, 'texto', [], { nome: 'A', idade: 3 }, { nome: 'Helena' }])(
    'corpo inválido %j → 422 DADOS_INVALIDOS',
    (valor) => {
      expect(erroDe(() => new PipeZod(esquema).transform(valor)).codigo).toBe('DADOS_INVALIDOS');
    },
  );

  it('a resposta não repete os valores recebidos', () => {
    const valorSensivel = 'senha-que-nao-pode-voltar';

    const erro = erroDe(() => new PipeZod(esquema).transform({ nome: valorSensivel, idade: 'x' }));

    expect(JSON.stringify({ m: erro.message, d: erro.detalhes })).not.toContain(valorSensivel);
  });
});
