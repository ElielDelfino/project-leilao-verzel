import { createServer } from 'node:net';

/**
 * Uma porta do loopback sem ninguém escutando: abre um servidor na porta 0, guarda a porta que o
 * sistema escolheu e fecha. Conectar nela dá ECONNREFUSED (simula a dependência fora).
 */
export async function portaFechada(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(0, '127.0.0.1', resolver);
  });
  const endereco = servidor.address();
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  if (endereco === null || typeof endereco === 'string') {
    throw new Error('porta-fechada: endereço inesperado');
  }
  return endereco.port;
}
