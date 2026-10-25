// Unidade: chave ativa e falha fechada do registro (specs/008 §Chaves, tarefa 078), sem banco.
import { randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { criarSegredosDaApi, type Env } from '../../../src/config/env.js';
import type { Banco, Transacao } from '../../../src/db/banco.js';
import { CadeiaDeLances } from '../../../src/modules/lances/cadeia.js';
import { ServicoDeChaves } from '../../../src/modules/lances/chaves.js';
import { registrarChaveDeAssinatura } from '../../../src/modules/lances/index.js';
import { verificar } from '../../../src/modules/lances/integridade/assinatura.js';
import { ENV_DE_TESTE } from '../../helpers/app-de-teste.js';

// Vetor público do RFC 8032 §7.1 TEST 1 (specs/008 §Chaves): não é segredo de nenhum ambiente.
const SEED_DO_VETOR = Buffer.from(
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
  'hex',
);
const HASH = 'af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb';

function envCom(seed: Uint8Array): Env {
  return {
    ...ENV_DE_TESTE,
    segredos: criarSegredosDaApi({
      chaveJwt: new Uint8Array(randomBytes(32)),
      chavePseudonimo: new Uint8Array(randomBytes(32)),
      sementeEd25519: seed,
    }),
  };
}

/** Banco cujo `consultar` devolve `resposta` sem executar o callback (ou rejeita). */
function bancoQueDevolve(resposta: () => Promise<unknown>): Banco {
  return {
    consultar: () => resposta() as Promise<never>,
    transaction: () => Promise.reject(new Error('sem transação no teste')),
    encerrar: () => Promise.resolve(),
  };
}

/** Nenhuma linha em signing_keys (usado onde o registro não é chamado). */
const semRegistro = (): Promise<unknown> => Promise.resolve(null);

describe('ServicoDeChaves', () => {
  it('deriva a chave pública e o keyId do vetor do RFC 8032', () => {
    const chaves = new ServicoDeChaves(envCom(SEED_DO_VETOR), bancoQueDevolve(semRegistro));

    expect(chaves.keyId).toBe('21fe31dfa154a261');
    expect(Buffer.from(chaves.chavePublica).toString('base64url')).toBe(
      '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    );
  });

  it('recusa assinar antes do registro', () => {
    const chaves = new ServicoDeChaves(envCom(SEED_DO_VETOR), bancoQueDevolve(semRegistro));

    expect(() => chaves.assinar(HASH)).toThrow('ainda não registrada');
  });

  it('falha fechada: banco fora rejeita o registro e a assinatura continua recusada', async () => {
    const chaves = new ServicoDeChaves(
      envCom(SEED_DO_VETOR),
      bancoQueDevolve(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    await expect(chaves.registrar()).rejects.toThrow('ECONNREFUSED');
    expect(() => chaves.assinar(HASH)).toThrow('ainda não registrada');
  });

  it('recusa quando signing_keys publica outra chave sob o mesmo keyId', async () => {
    const outra = randomBytes(32);
    const chaves = new ServicoDeChaves(
      envCom(SEED_DO_VETOR),
      bancoQueDevolve(() => Promise.resolve(outra)),
    );

    await expect(chaves.registrar()).rejects.toThrow('não publica a chave ativa');
    expect(() => chaves.assinar(HASH)).toThrow('ainda não registrada');
  });

  it('depois do registro assina o hash do vetor com a assinatura da spec', async () => {
    // A chave pública do vetor (specs/008 §Chaves), como signing_keys a devolveria.
    const publicada = Buffer.from('11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo', 'base64url');
    const chaves = new ServicoDeChaves(
      envCom(SEED_DO_VETOR),
      bancoQueDevolve(() => Promise.resolve(publicada)),
    );

    await chaves.registrar();
    const { assinatura, keyId } = chaves.assinar(HASH);

    expect(keyId).toBe('21fe31dfa154a261');
    expect(assinatura).toBe(
      'MOumYMXLSRf1yq3BzD9MT4kPV0kMPUFw4cUEvbCd-u90psSijUKdOoE4nO9hy__a9mAzFP3ygg-RNp5DNRDyDQ',
    );
    expect(verificar(chaves.chavePublica, HASH, assinatura)).toBe(true);
  });

  it('não expõe a seed nem a chave do pseudônimo ao serializar ou inspecionar', () => {
    const seed = new Uint8Array(randomBytes(32));
    const chaves = new ServicoDeChaves(envCom(seed), bancoQueDevolve(semRegistro));
    const textoDaSeed = Buffer.from(seed).toString('base64url');

    expect(JSON.stringify(chaves)).not.toContain(textoDaSeed);
    expect(Object.keys(chaves).sort()).toEqual(['chavePublica', 'keyId']);
  });

  it('registrarChaveDeAssinatura propaga a falha do registro (o boot não sobe)', async () => {
    const chaves = new ServicoDeChaves(
      envCom(SEED_DO_VETOR),
      bancoQueDevolve(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    const app = { get: () => chaves } as unknown as Parameters<
      typeof registrarChaveDeAssinatura
    >[0];

    await expect(registrarChaveDeAssinatura(app)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('CadeiaDeLances: entradas recusadas antes de tocar o banco', () => {
  const chaves = new ServicoDeChaves(envCom(SEED_DO_VETOR), bancoQueDevolve(semRegistro));
  const cadeia = new CadeiaDeLances(chaves);
  // Qualquer uso da tx falharia: as recusas abaixo acontecem antes.
  const tx = {} as Transacao;
  const base = {
    loteId: '0198f3c0-7b1a-7c00-8000-000000000001',
    licitanteId: randomUUID(),
    valorCentavos: 15_000,
    criadoEm: new Date('2026-10-27T14:03:07.120Z'),
    idempotencyKey: randomUUID(),
  };

  it.each([
    ['licitanteId em maiúsculas', { licitanteId: base.licitanteId.toUpperCase() }],
    ['valor abaixo do mínimo', { valorCentavos: 99 }],
    ['valor fracionário', { valorCentavos: 150.5 }],
    ['valor acima de 2^53 − 1', { valorCentavos: Number.MAX_SAFE_INTEGER + 2 }],
    ['instante inválido', { criadoEm: new Date(Number.NaN) }],
  ])('anexar recusa %s com RangeError', async (_nome, troca) => {
    await expect(cadeia.anexar(tx, { ...base, ...troca })).rejects.toBeInstanceOf(RangeError);
  });

  it('selar recusa instante inválido com RangeError', async () => {
    await expect(
      cadeia.selar(tx, { loteId: base.loteId, status: 'cancelado', seladoEm: new Date('x') }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
