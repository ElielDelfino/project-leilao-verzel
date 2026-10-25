import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { violacoesSerias } from '../apoio/axe';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { envelopeDeErro, ORIGEM, servidor } from '../apoio/servidor';
import {
  auditoriaDoCaso,
  CHAVES,
  KEY_ID,
  LOTE_ID,
  servirAuditoria,
  servirChaves,
} from './apoio-auditoria';

const TIMEOUT_LONGO_MS = 20_000;

function abrir(escuro = false) {
  simularPreferenciaDoSistema(escuro);
  return renderizarApp(`/auditoria/${LOTE_ID}`);
}

async function verificar() {
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Verificar no meu navegador' }));
}

function regiaoDoResultado(): HTMLElement {
  return screen.getByRole('status', { name: '' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/auditoria/:loteId', () => {
  it('carregando: mostra o estado e o único h1', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/auditoria/lotes/:id`, () => new Promise<Response>(() => undefined)),
    );
    abrir();

    expect(await screen.findByText('Carregando auditoria…')).toHaveAttribute('role', 'status');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe('Auditoria do lote · Casa de Leilões'));
  });

  it(
    'lote íntegro: veredito com ícone e texto, selo, lances e verificação local concordante',
    async () => {
      servidor.use(servirAuditoria(auditoriaDoCaso('integro-selado')), servirChaves());
      abrir();

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Auditoria do lote' }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText('Íntegro: o servidor não encontrou adulteração.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Problemas encontrados' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ver lote' })).toHaveAttribute(
        'href',
        `/lotes/${LOTE_ID}`,
      );
      expect(screen.getByText('3 lances')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();

      const selo = screen.getByRole('region', { name: 'Selo do lote' });
      expect(within(selo).getByText('Situação')).toBeInTheDocument();
      expect(within(selo).getByText('Chave de assinatura')).toBeInTheDocument();
      expect(within(selo).getByText(KEY_ID)).toBeInTheDocument();

      const tabela = screen.getByRole('table', { name: 'Lances do lote' });
      expect(within(tabela).getAllByRole('row')).toHaveLength(4);
      const primeiro = auditoriaDoCaso('integro-selado').lances[0];
      expect(within(tabela).getByText(`${primeiro?.hash.slice(0, 8)}…`)).toBeInTheDocument();
      expect(within(tabela).getAllByText(/^Hash: [0-9a-f]{64}$/)).toHaveLength(3);

      // A região do resultado existe desde o início e começa vazia.
      expect(regiaoDoResultado()).toBeEmptyDOMElement();
      await verificar();
      const regiao = regiaoDoResultado();
      expect(
        await within(regiao).findByText(
          'Verificação no seu navegador: íntegro. Hashes, assinaturas e selo conferem.',
        ),
      ).toBeInTheDocument();
      expect(
        within(regiao).getByText('O resultado do seu navegador é igual ao do servidor.'),
      ).toBeInTheDocument();
      expect(
        within(regiao).getByText(new RegExp(`Chave pública usada na verificação: ${KEY_ID}\\.`)),
      ).toBeInTheDocument();
      expect(within(regiao).queryByRole('alert')).not.toBeInTheDocument();
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'lote adulterado: mostra "lance #2: hash não confere" no servidor e no navegador',
    async () => {
      servidor.use(servirAuditoria(auditoriaDoCaso('valor-alterado')), servirChaves());
      abrir();

      expect(
        await screen.findByText('Adulterado: o servidor encontrou 1 problema.'),
      ).toBeInTheDocument();
      const problemas = screen.getByRole('heading', { level: 2, name: 'Problemas encontrados' });
      expect(
        within(problemas.parentElement as HTMLElement).getByText('lance #2: hash não confere'),
      ).toBeInTheDocument();

      await verificar();
      const regiao = regiaoDoResultado();
      expect(
        await within(regiao).findByText('Verificação no seu navegador: adulterado (1 problema).'),
      ).toBeInTheDocument();
      expect(
        within(regiao).getByRole('heading', { name: 'Problemas encontrados no seu navegador' }),
      ).toBeInTheDocument();
      expect(within(regiao).getByText('lance #2: hash não confere')).toBeInTheDocument();
      expect(
        within(regiao).getByText('O resultado do seu navegador é igual ao do servidor.'),
      ).toBeInTheDocument();
    },
    TIMEOUT_LONGO_MS,
  );

  it('problemas do selo aparecem como "selo: …" e vários problemas no plural', async () => {
    servidor.use(servirAuditoria(auditoriaDoCaso('lance-do-meio-apagado')));
    abrir();

    expect(
      await screen.findByText('Adulterado: o servidor encontrou 3 problemas.'),
    ).toBeInTheDocument();
    expect(screen.getByText('lance #3: sequência fora de ordem')).toBeInTheDocument();
    expect(screen.getByText('lance #3: hash anterior não confere')).toBeInTheDocument();
    expect(screen.getByText('selo: total de lances não confere com o selo')).toBeInTheDocument();
  });

  it(
    'servidor e navegador discordando mostram aviso explícito',
    async () => {
      servidor.use(
        servirAuditoria(auditoriaDoCaso('valor-alterado', { veredito: 'integro', problemas: [] })),
        servirChaves(),
      );
      abrir();

      await screen.findByText('Íntegro: o servidor não encontrou adulteração.');
      await verificar();
      const regiao = regiaoDoResultado();
      expect(await within(regiao).findByRole('alert')).toHaveTextContent(
        'Atenção: o resultado do seu navegador é diferente do resultado do servidor.',
      );
      expect(
        within(regiao).getByText('Verificação no seu navegador: adulterado (1 problema).'),
      ).toBeInTheDocument();
      expect(
        within(regiao).queryByText('O resultado do seu navegador é igual ao do servidor.'),
      ).not.toBeInTheDocument();
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'mesmo veredito com outra lista de problemas também é discordância',
    async () => {
      servidor.use(
        servirAuditoria(
          auditoriaDoCaso('valor-alterado', {
            problemas: [{ codigo: 'HASH_DIVERGENTE', seq: 3, mensagem: 'x' }],
          }),
        ),
        servirChaves(),
      );
      abrir();

      await screen.findByText('Adulterado: o servidor encontrou 1 problema.');
      await verificar();
      expect(await within(regiaoDoResultado()).findByRole('alert')).toHaveTextContent(
        'Atenção: o resultado do seu navegador é diferente do resultado do servidor.',
      );
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'lote sem lances e sem selo: textos próprios e verificação íntegra',
    async () => {
      servidor.use(
        servirAuditoria({
          ...auditoriaDoCaso('integro-ao-vivo'),
          lances: [],
          lote: { ...auditoriaDoCaso('integro-ao-vivo').lote, totalLances: 0 },
        }),
        servirChaves(),
      );
      abrir();

      expect(
        await screen.findByText('Nenhum lance foi registrado neste lote.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Nenhum lance')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(
        screen.getByText(
          'Este lote ainda não foi selado. O selo é gerado no encerramento ou no cancelamento.',
        ),
      ).toBeInTheDocument();

      await verificar();
      expect(
        await within(regiaoDoResultado()).findByText(
          'Verificação no seu navegador: íntegro. Hashes, assinaturas e selo conferem.',
        ),
      ).toBeInTheDocument();
    },
    TIMEOUT_LONGO_MS,
  );

  it('404: mostra "Lote não encontrado" e o link para a vitrine', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/auditoria/lotes/:id`, () => envelopeDeErro('NAO_ENCONTRADO', 404)),
    );
    abrir();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lote não encontrado' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Não encontramos o que você procurou.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute('href', '/');
  });

  it('falha: mostra a mensagem do código e "Tentar de novo" refaz a consulta', async () => {
    let chamadas = 0;
    servidor.use(
      http.get(`${ORIGEM}/api/auditoria/lotes/:id`, () => {
        chamadas += 1;
        return chamadas === 1
          ? envelopeDeErro('INDISPONIVEL', 503)
          : HttpResponse.json({ sucesso: true, dados: auditoriaDoCaso('integro-ao-vivo') });
      }),
    );
    abrir();

    expect(
      await screen.findByText('O serviço está indisponível agora. Tente de novo em instantes.'),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(
      await screen.findByText('Íntegro: o servidor não encontrou adulteração.'),
    ).toBeInTheDocument();
    expect(chamadas).toBe(2);
  });

  it('sem crypto.subtle: avisa, sem veredito local e sem consultar as chaves', async () => {
    let chamadasDeChaves = 0;
    servidor.use(
      servirAuditoria(auditoriaDoCaso('integro-selado')),
      http.get(`${ORIGEM}/api/auditoria/chaves`, () => {
        chamadasDeChaves += 1;
        return HttpResponse.json({ sucesso: true, dados: CHAVES });
      }),
    );
    abrir();
    await screen.findByText('Íntegro: o servidor não encontrou adulteração.');

    vi.stubGlobal('crypto', {});
    await verificar();

    expect(await within(regiaoDoResultado()).findByRole('alert')).toHaveTextContent(
      'Seu navegador não permite a verificação nesta página. Abra o site por uma conexão segura (HTTPS) e tente de novo.',
    );
    expect(screen.queryByText(/Verificação no seu navegador:/)).not.toBeInTheDocument();
    expect(chamadasDeChaves).toBe(0);
  });

  it('falha na consulta de chaves: "não foi possível verificar agora", nunca um veredito', async () => {
    servidor.use(
      servirAuditoria(auditoriaDoCaso('integro-selado')),
      http.get(`${ORIGEM}/api/auditoria/chaves`, () => envelopeDeErro('INDISPONIVEL', 503)),
    );
    abrir();
    await screen.findByText('Íntegro: o servidor não encontrou adulteração.');

    await verificar();

    expect(await within(regiaoDoResultado()).findByRole('alert')).toHaveTextContent(
      'Não foi possível verificar agora. Tente de novo em instantes.',
    );
    expect(screen.queryByText(/Verificação no seu navegador:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verificar no meu navegador' })).toBeEnabled();
  });

  it(
    'keyId ausente refaz GET /chaves uma vez antes de acusar chave desconhecida',
    async () => {
      const contador = { n: 0 };
      let resposta = 0;
      servidor.use(
        servirAuditoria(auditoriaDoCaso('integro-selado')),
        http.get(`${ORIGEM}/api/auditoria/chaves`, () => {
          contador.n += 1;
          resposta += 1;
          return HttpResponse.json({ sucesso: true, dados: resposta === 1 ? [] : CHAVES });
        }),
      );
      abrir();
      await screen.findByText('Íntegro: o servidor não encontrou adulteração.');

      await verificar();

      expect(
        await within(regiaoDoResultado()).findByText(
          'Verificação no seu navegador: íntegro. Hashes, assinaturas e selo conferem.',
        ),
      ).toBeInTheDocument();
      expect(contador.n).toBe(2);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'chave que continua ausente depois do refetch vira problema, não exceção',
    async () => {
      const contador = { n: 0 };
      servidor.use(servirAuditoria(auditoriaDoCaso('integro-selado')), servirChaves([], contador));
      abrir();
      await screen.findByText('Íntegro: o servidor não encontrou adulteração.');

      await verificar();

      const regiao = regiaoDoResultado();
      expect(
        await within(regiao).findByText(/Verificação no seu navegador: adulterado/),
      ).toBeInTheDocument();
      expect(
        within(regiao).getAllByText(/chave de assinatura desconhecida/).length,
      ).toBeGreaterThan(0);
      expect(within(regiao).getByRole('alert')).toHaveTextContent('Atenção:');
      expect(contador.n).toBe(2);
    },
    TIMEOUT_LONGO_MS,
  );

  it.each([false, true])(
    'axe sem violações sérias (tema escuro: %s)',
    async (escuro) => {
      servidor.use(servirAuditoria(auditoriaDoCaso('valor-alterado')), servirChaves());
      abrir(escuro);
      await screen.findByText('Adulterado: o servidor encontrou 1 problema.');
      await verificar();
      await within(regiaoDoResultado()).findByText(/Verificação no seu navegador:/);

      expect(await violacoesSerias()).toEqual([]);
    },
    TIMEOUT_LONGO_MS,
  );
});
