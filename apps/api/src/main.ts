import 'reflect-metadata';

import { carregarEnv } from './config/env.js';
import { criarApi, descreverFalhaNoBoot } from './servidor.js';

// Em contêiner a API precisa escutar em todas as interfaces; em produção só o Caddy a alcança
// (specs/014: portas internas).
const HOST = '0.0.0.0';

async function iniciar(): Promise<void> {
  const env = carregarEnv(process.env);
  const app = await criarApi(env);
  await app.listen(env.API_PORT, HOST);
}

iniciar().catch((erro: unknown) => {
  // O logger ainda pode não existir (env inválido): escreve direto no stderr e sai com erro.
  process.stderr.write(descreverFalhaNoBoot(erro));
  process.exit(1);
});
