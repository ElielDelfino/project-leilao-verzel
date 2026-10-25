// Provider do cliente da Scryfall: monta com o ENV e o cliente Redis único (CLIENTE_REDIS).
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ENV } from '../../../../src/config/env.js';
import {
  CLIENTE_SCRYFALL,
  provedorDoClienteScryfall,
} from '../../../../src/modules/catalogo/scryfall/scryfall.provider.js';
import type { ClienteScryfall } from '../../../../src/modules/catalogo/scryfall/cliente-scryfall.js';
import { CLIENTE_REDIS } from '../../../../src/redis/redis.module.js';
import { ENV_DE_TESTE, redisFalso } from '../../../helpers/app-de-teste.js';

describe('provedorDoClienteScryfall', () => {
  it('cria o ClienteScryfall a partir do ENV e do CLIENTE_REDIS injetados', async () => {
    const modulo = await Test.createTestingModule({
      providers: [
        provedorDoClienteScryfall,
        { provide: ENV, useValue: ENV_DE_TESTE },
        { provide: CLIENTE_REDIS, useValue: redisFalso() },
      ],
    }).compile();

    const cliente = modulo.get<ClienteScryfall>(CLIENTE_SCRYFALL);

    expect(typeof cliente.buscar).toBe('function');
    expect(typeof cliente.obterCarta).toBe('function');
    await modulo.close();
  });
});
