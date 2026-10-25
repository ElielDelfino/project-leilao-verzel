// Unidade: o limite do comprovante (specs/011 §Rate limit): teto global de 600 por minuto na
// chave `comprovante:global`; 429 passa; falha do contador (Redis fora) é falha ABERTA, com aviso.
import { describe, expect, it, vi } from 'vitest';

import { ErroApi } from '../../../../src/common/erros/erro-api.js';
import type { LimiteDeTentativas } from '../../../../src/common/limite/limite-de-tentativas.js';
import {
  CHAVE_DO_LIMITE_DO_COMPROVANTE,
  consumirLimiteDoComprovante,
  REGRA_DO_COMPROVANTE,
} from '../../../../src/modules/liquidacao/comprovantes/limite-do-comprovante.js';

function limiteFalso(consumir: LimiteDeTentativas['consumir']): LimiteDeTentativas {
  return { consumir } as unknown as LimiteDeTentativas;
}

describe('consumirLimiteDoComprovante', () => {
  it('conta na chave global com a regra de 600 por 60 s', async () => {
    const consumir = vi.fn<LimiteDeTentativas['consumir']>().mockResolvedValue(undefined);

    await consumirLimiteDoComprovante(limiteFalso(consumir), vi.fn());

    expect(CHAVE_DO_LIMITE_DO_COMPROVANTE).toBe('comprovante:global');
    expect(REGRA_DO_COMPROVANTE).toEqual({ limite: 600, janelaS: 60 });
    expect(consumir).toHaveBeenCalledWith('comprovante:global', REGRA_DO_COMPROVANTE);
  });

  it('repassa o 429 MUITAS_TENTATIVAS', async () => {
    const recusa = new ErroApi({
      codigo: 'MUITAS_TENTATIVAS',
      status: 429,
      mensagem: 'Muitas tentativas.',
      retryAfterSegundos: 7,
    });
    const consumir = vi.fn<LimiteDeTentativas['consumir']>().mockRejectedValue(recusa);

    await expect(consumirLimiteDoComprovante(limiteFalso(consumir), vi.fn())).rejects.toBe(recusa);
  });

  it('com o Redis fora, deixa passar e avisa no log, sem vazar a causa', async () => {
    const consumir = vi
      .fn<LimiteDeTentativas['consumir']>()
      .mockRejectedValue(new Error('ECONNREFUSED redis://segredo@host'));
    const avisar = vi.fn<(mensagem: string) => void>();

    await expect(
      consumirLimiteDoComprovante(limiteFalso(consumir), avisar),
    ).resolves.toBeUndefined();

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]?.[0]).not.toContain('segredo');
  });
});
