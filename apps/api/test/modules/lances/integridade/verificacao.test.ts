// Unidade: verificação da cadeia e as adulterações de specs/008 §Verificação e §Critérios de aceite.
import { randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assinar,
  type ChavesDeAssinatura,
  derivarChaves,
} from '../../../../src/modules/lances/integridade/assinatura.js';
import {
  hashDoLance,
  hashDoSelo,
  hashGenese,
} from '../../../../src/modules/lances/integridade/hash.js';
import {
  type ChavePublicada,
  type LanceRegistrado,
  type SeloRegistrado,
  verificarCadeia,
} from '../../../../src/modules/lances/integridade/verificacao.js';

const LOTE = randomUUID();
const LEGITIMA = derivarChaves(new Uint8Array(randomBytes(32)));
const INTRUSA = derivarChaves(new Uint8Array(randomBytes(32)));
const PUBLICADAS: readonly ChavePublicada[] = [
  { keyId: LEGITIMA.keyId, chavePublica: LEGITIMA.chavePublica },
];

interface Proposta {
  readonly pseudonimo: string;
  readonly valorCentavos: number;
}

function criadoEm(seq: number): string {
  return new Date(Date.UTC(2026, 9, 27, 14, 0, seq, 120)).toISOString();
}

/** Assina um lance sobre o `hashAnterior` dado, como a transação do lance faria. */
function lance(
  seq: number,
  hashAnterior: string,
  proposta: Proposta,
  chaves: ChavesDeAssinatura = LEGITIMA,
): LanceRegistrado {
  const dados = { seq, hashAnterior, criadoEm: criadoEm(seq), ...proposta };
  const hash = hashDoLance({ loteId: LOTE, ...dados });
  return { ...dados, hash, assinatura: assinar(chaves.chavePrivada, hash), keyId: chaves.keyId };
}

/** Encadeia as propostas a partir de `inicio`, depois do `hashAnterior` dado. */
function encadear(
  propostas: readonly Proposta[],
  hashAnterior = hashGenese(LOTE),
  inicio = 1,
  chaves: ChavesDeAssinatura = LEGITIMA,
): LanceRegistrado[] {
  return propostas.reduce<LanceRegistrado[]>((cadeia, proposta, i) => {
    const anterior = cadeia.at(-1)?.hash ?? hashAnterior;
    return [...cadeia, lance(inicio + i, anterior, proposta, chaves)];
  }, []);
}

function selar(
  lances: readonly LanceRegistrado[],
  chaves: ChavesDeAssinatura = LEGITIMA,
): SeloRegistrado {
  const ultimo = lances.at(-1);
  const dados = {
    status: 'encerrado' as const,
    totalLances: lances.length,
    hashFinal: ultimo?.hash ?? hashGenese(LOTE),
    vencedorPseudonimo: ultimo?.pseudonimo ?? null,
    valorArremateCentavos: ultimo?.valorCentavos ?? null,
    seladoEm: '2026-10-27T15:00:00.000Z',
  };
  const hash = hashDoSelo({ loteId: LOTE, ...dados });
  return { ...dados, assinatura: assinar(chaves.chavePrivada, hash), keyId: chaves.keyId };
}

const PROPOSTAS: readonly Proposta[] = [
  { pseudonimo: 'Licitante #aaaaaa', valorCentavos: 10000 },
  { pseudonimo: 'Licitante #bbbbbb', valorCentavos: 11000 },
  { pseudonimo: 'Licitante #aaaaaa', valorCentavos: 12000 },
  { pseudonimo: 'Licitante #cccccc', valorCentavos: 13000 },
];
const CADEIA = encadear(PROPOSTAS);
const SELO = selar(CADEIA);

/** Lance de índice `i` da cadeia íntegra (0 a 3). */
function elo(i: number): LanceRegistrado {
  const encontrado = CADEIA[i];
  if (encontrado === undefined) throw new Error(`a cadeia de teste não tem o índice ${String(i)}`);
  return encontrado;
}

function verificar(lances: readonly LanceRegistrado[], selo: SeloRegistrado | null = null) {
  return verificarCadeia({ loteId: LOTE, lances, selo, chaves: PUBLICADAS });
}

function codigos(resultado: ReturnType<typeof verificar>): string[] {
  return resultado.problemas.map((p) => `${p.codigo}@${String(p.seq)}`);
}

function trocar(
  cadeia: readonly LanceRegistrado[],
  indice: number,
  novo: LanceRegistrado,
): LanceRegistrado[] {
  return cadeia.map((l, i) => (i === indice ? novo : l));
}

describe('verificarCadeia: cadeias íntegras', () => {
  it('cadeia de 4 lances sem selo é íntegra', () => {
    expect(verificar(CADEIA)).toEqual({ veredito: 'integro', problemas: [] });
  });

  it('cadeia de 4 lances com selo é íntegra', () => {
    expect(verificar(CADEIA, SELO)).toEqual({ veredito: 'integro', problemas: [] });
  });

  it('lote sem lances e sem selo é íntegro', () => {
    expect(verificar([])).toEqual({ veredito: 'integro', problemas: [] });
  });

  it('lote sem lances com selo de total 0 e hash da gênese é íntegro', () => {
    const cancelado = selar([]);
    expect(cancelado.hashFinal).toBe(hashGenese(LOTE));
    expect(verificar([], { ...cancelado })).toEqual({ veredito: 'integro', problemas: [] });
  });

  it('aceita lances assinados com uma chave antiga ainda publicada (rotação)', () => {
    const antiga = derivarChaves(new Uint8Array(randomBytes(32)));
    const primeiros = encadear(PROPOSTAS.slice(0, 2), undefined, 1, antiga);
    const depois = encadear(PROPOSTAS.slice(2), primeiros.at(-1)?.hash, 3);
    const chaves = [...PUBLICADAS, { keyId: antiga.keyId, chavePublica: antiga.chavePublica }];

    const resultado = verificarCadeia({
      loteId: LOTE,
      lances: [...primeiros, ...depois],
      selo: null,
      chaves,
    });
    expect(resultado.veredito).toBe('integro');
  });

  it('não altera a entrada', () => {
    const copia = structuredClone(CADEIA);
    verificar(CADEIA, SELO);
    expect(CADEIA).toEqual(copia);
  });
});

describe('verificarCadeia: as 5 adulterações de specs/008 §Critérios de aceite', () => {
  it('alterar o valor de um lance → HASH_DIVERGENTE no seq', () => {
    const alterado = { ...elo(1), valorCentavos: 99999 };
    const resultado = verificar(trocar(CADEIA, 1, alterado));

    expect(resultado.veredito).toBe('adulterado');
    expect(codigos(resultado)).toEqual(['HASH_DIVERGENTE@2']);
  });

  it('apagar o lance do meio → SEQ_FORA_DE_ORDEM e HASH_ANTERIOR_DIVERGENTE no seq seguinte', () => {
    const semOMeio = CADEIA.filter((l) => l.seq !== 2);
    const resultado = verificar(semOMeio);

    expect(resultado.veredito).toBe('adulterado');
    expect(codigos(resultado)).toEqual(['SEQ_FORA_DE_ORDEM@3', 'HASH_ANTERIOR_DIVERGENTE@3']);
  });

  it('inserir um lance no meio → SEQ_FORA_DE_ORDEM e HASH_ANTERIOR_DIVERGENTE, mesmo encadeado', () => {
    // O intruso repete o seq 2 depois do lance 2 original, com hashAnterior correto e sem a chave.
    const intruso = lance(
      2,
      elo(1).hash,
      { pseudonimo: 'Licitante #dddddd', valorCentavos: 50000 },
      INTRUSA,
    );
    const resultado = verificar([...CADEIA.slice(0, 2), intruso, ...CADEIA.slice(2)]);

    expect(resultado.veredito).toBe('adulterado');
    expect(codigos(resultado)).toEqual([
      'SEQ_FORA_DE_ORDEM@2',
      'CHAVE_DESCONHECIDA@2',
      'HASH_ANTERIOR_DIVERGENTE@3',
    ]);
  });

  it('inserir um lance no fim de lote selado → SEQ ok, mas o selo diverge', () => {
    const intruso = lance(
      5,
      elo(3).hash,
      { pseudonimo: 'Licitante #dddddd', valorCentavos: 50000 },
      INTRUSA,
    );
    const resultado = verificar([...CADEIA, intruso], SELO);

    expect(codigos(resultado)).toEqual([
      'CHAVE_DESCONHECIDA@5',
      'SELO_TOTAL_DIVERGENTE@null',
      'SELO_HASH_FINAL_DIVERGENTE@null',
    ]);
  });

  it('recalcular a cadeia sem a chave, assinando com outra → CHAVE_DESCONHECIDA em cada lance refeito', () => {
    const refeitos = encadear(
      [{ pseudonimo: 'Licitante #bbbbbb', valorCentavos: 10500 }, ...PROPOSTAS.slice(2)],
      elo(0).hash,
      2,
      INTRUSA,
    );
    const resultado = verificar([elo(0), ...refeitos]);

    expect(resultado.veredito).toBe('adulterado');
    expect(codigos(resultado)).toEqual([
      'CHAVE_DESCONHECIDA@2',
      'CHAVE_DESCONHECIDA@3',
      'CHAVE_DESCONHECIDA@4',
    ]);
  });

  it('recalcular a cadeia sem a chave, mantendo o keyId legítimo → ASSINATURA_INVALIDA em cada lance', () => {
    const refeitos = encadear(
      [{ pseudonimo: 'Licitante #bbbbbb', valorCentavos: 10500 }, ...PROPOSTAS.slice(2)],
      elo(0).hash,
      2,
      INTRUSA,
    ).map((l) => ({ ...l, keyId: LEGITIMA.keyId }));
    const resultado = verificar([elo(0), ...refeitos]);

    expect(codigos(resultado)).toEqual([
      'ASSINATURA_INVALIDA@2',
      'ASSINATURA_INVALIDA@3',
      'ASSINATURA_INVALIDA@4',
    ]);
  });

  it('truncar o fim de um lote selado → SELO_TOTAL_DIVERGENTE e SELO_HASH_FINAL_DIVERGENTE', () => {
    const resultado = verificar(CADEIA.slice(0, 3), SELO);

    expect(resultado.veredito).toBe('adulterado');
    expect(resultado.problemas.map((p) => [p.codigo, p.seq])).toEqual([
      ['SELO_TOTAL_DIVERGENTE', null],
      ['SELO_HASH_FINAL_DIVERGENTE', null],
    ]);
  });
});

describe('verificarCadeia: demais casos', () => {
  it('cada campo alterado de um lance é detectado', () => {
    const original = elo(2);
    const variantes: LanceRegistrado[] = [
      { ...original, seq: 9 },
      { ...original, pseudonimo: 'Licitante #ffffff' },
      { ...original, valorCentavos: original.valorCentavos + 1 },
      { ...original, criadoEm: '2026-10-27T14:00:03.121Z' },
      { ...original, hashAnterior: elo(0).hash },
      { ...original, hash: elo(0).hash },
      { ...original, assinatura: elo(0).assinatura },
      { ...original, keyId: INTRUSA.keyId },
    ];
    for (const variante of variantes) {
      expect(verificar(trocar(CADEIA, 2, variante)).veredito).toBe('adulterado');
    }
  });

  it('o primeiro lance precisa apontar para a gênese do próprio lote', () => {
    const deOutroLote = { ...elo(0), hashAnterior: hashGenese(randomUUID()) };
    expect(codigos(verificar(trocar(CADEIA, 0, deOutroLote)))).toContain(
      'HASH_ANTERIOR_DIVERGENTE@1',
    );
  });

  it('cadeia íntegra de outro lote é adulterada para este lote', () => {
    const resultado = verificarCadeia({
      loteId: randomUUID(),
      lances: CADEIA,
      selo: null,
      chaves: PUBLICADAS,
    });
    expect(codigos(resultado)).toEqual([
      'HASH_ANTERIOR_DIVERGENTE@1',
      'HASH_DIVERGENTE@1',
      'HASH_DIVERGENTE@2',
      'HASH_DIVERGENTE@3',
      'HASH_DIVERGENTE@4',
    ]);
  });

  it('cadeia que não começa no seq 1 → SEQ_FORA_DE_ORDEM', () => {
    expect(codigos(verificar(CADEIA.slice(1)))).toEqual([
      'SEQ_FORA_DE_ORDEM@2',
      'HASH_ANTERIOR_DIVERGENTE@2',
    ]);
  });

  it('campo fora da forma canônica (não reproduzível) vira HASH_DIVERGENTE, sem lançar', () => {
    const alterado = { ...elo(1), criadoEm: '2026-10-27 14:00:02' };
    expect(codigos(verificar(trocar(CADEIA, 1, alterado)))).toEqual(['HASH_DIVERGENTE@2']);
  });

  it('assinatura malformada → ASSINATURA_INVALIDA, sem lançar', () => {
    const alterado = { ...elo(1), assinatura: 'não-é-base64url' };
    expect(codigos(verificar(trocar(CADEIA, 1, alterado)))).toEqual(['ASSINATURA_INVALIDA@2']);
  });

  it('selo com campo alterado → SELO_ASSINATURA_INVALIDA', () => {
    const resultado = verificar(CADEIA, { ...SELO, valorArremateCentavos: 1 });
    expect(codigos(resultado)).toEqual(['SELO_ASSINATURA_INVALIDA@null']);
  });

  it('selo assinado por chave não publicada → SELO_ASSINATURA_INVALIDA', () => {
    expect(codigos(verificar(CADEIA, selar(CADEIA, INTRUSA)))).toEqual([
      'SELO_ASSINATURA_INVALIDA@null',
    ]);
  });

  it('selo de lote sem lances com total ou hash final errados', () => {
    const resultado = verificar([], SELO);
    expect(codigos(resultado)).toEqual([
      'SELO_TOTAL_DIVERGENTE@null',
      'SELO_HASH_FINAL_DIVERGENTE@null',
    ]);
  });

  it('cada problema tem mensagem em texto e não ecoa a assinatura', () => {
    const resultado = verificar(CADEIA.slice(0, 3), { ...SELO, valorArremateCentavos: 1 });
    for (const problema of resultado.problemas) {
      expect(problema.mensagem.length).toBeGreaterThan(0);
      expect(problema.mensagem).not.toContain(SELO.assinatura);
    }
  });
});
