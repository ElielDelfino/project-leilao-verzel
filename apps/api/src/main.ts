import 'reflect-metadata';

import { carregarEnv } from './config/env.js';
import { registrarChaveDeAssinatura } from './modules/lances/index.js';
import { AgendadorDoEncerramento } from './modules/liquidacao/index.js';
import { criarApi, descreverFalhaNoBoot } from './servidor.js';

// Em contêiner a API precisa escutar em todas as interfaces; em produção só o Caddy a alcança
// (specs/014: portas internas).
const HOST = '0.0.0.0';

async function iniciar(): Promise<void> {
  const env = carregarEnv(process.env);
  const app = await criarApi(env);
  // Falha fechada (specs/008 §Chaves): sem a chave publicada em signing_keys, a API não sobe.
  await registrarChaveDeAssinatura(app);
  await app.listen(env.API_PORT, HOST);
  // Job de 1 s (specs/010): só depois do listen; sem chave registrada ele não liga (falha fechada).
  const agendador = app.get(AgendadorDoEncerramento);
  await agendador.iniciar({ registrarChave: () => registrarChaveDeAssinatura(app) });
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      // Espera o tick atual terminar antes de fechar a API (e o banco).
      void agendador.parar().finally(() => app.close());
    });
  }
}

iniciar().catch((erro: unknown) => {
  // O logger ainda pode não existir (env inválido): escreve direto no stderr e sai com erro.
  process.stderr.write(descreverFalhaNoBoot(erro));
  process.exit(1);
});
