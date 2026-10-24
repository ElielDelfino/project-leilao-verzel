import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { CODIGOS_DE_ERRO } from '../../../src/common/erros/codigos.js';

interface ContratoComErro {
  components: {
    schemas: {
      Erro: { properties: { erro: { properties: { codigo: { enum: string[] } } } } };
    };
  };
}

const CAMINHO_OPENAPI = fileURLToPath(new URL('../../../openapi.yaml', import.meta.url));

function codigosDoOpenApi(): string[] {
  const contrato = parse(readFileSync(CAMINHO_OPENAPI, 'utf8')) as ContratoComErro;
  return contrato.components.schemas.Erro.properties.erro.properties.codigo.enum;
}

describe('CODIGOS_DE_ERRO', () => {
  it('é exatamente o catálogo de códigos do openapi.yaml (specs/001 §Contratos)', () => {
    expect([...CODIGOS_DE_ERRO].sort()).toEqual([...codigosDoOpenApi()].sort());
  });

  it('não tem códigos repetidos', () => {
    expect(new Set(CODIGOS_DE_ERRO).size).toBe(CODIGOS_DE_ERRO.length);
  });
});
