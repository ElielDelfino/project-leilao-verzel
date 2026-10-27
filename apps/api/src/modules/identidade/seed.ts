// Etapa do `pnpm db:seed` do módulo identidade (specs/003 RF-03, ADR 0027 D14): as 3 contas demo
// com a senha de SEED_DEMO_PASSWORD. Idempotente: ON CONFLICT (email) DO NOTHING.
// Roda com type stripping do Node (db/seed.ts): só sintaxe TypeScript apagável aqui e no que
// este arquivo importa (schema.ts e senha.ts).
import type { Transacao } from '../../db/banco.js';
import type { EtapaDoSeed } from '../../db/seed.js';
import { users } from './schema.js';
import { gerarHashDeSenha } from './senha.js';

/** specs/014 §Segredos: 10 a 128 caracteres A–Z a–z 0–9 - _. */
const FORMATO_DA_SENHA_DEMO = /^[A-Za-z0-9_-]{10,128}$/;

const CONTAS_DEMO = [
  { nome: 'Leiloeiro Demo', email: 'leiloeiro@demo.local', papel: 'leiloeiro' },
  { nome: 'Helena', email: 'helena@demo.local', papel: 'licitante' },
  { nome: 'Otávio', email: 'otavio@demo.local', papel: 'licitante' },
] as const;

async function criarContasDemo(
  tx: Transacao,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const senha = env['SEED_DEMO_PASSWORD'];
  if (senha === undefined || !FORMATO_DA_SENHA_DEMO.test(senha)) {
    throw new Error('SEED_DEMO_PASSWORD ausente ou fora do formato (10 a 128 de A-Z a-z 0-9 - _)');
  }
  const linhas = await Promise.all(
    CONTAS_DEMO.map(async (conta) => ({ ...conta, senhaHash: await gerarHashDeSenha(senha) })),
  );
  await tx.insert(users).values(linhas).onConflictDoNothing({ target: users.email });
}

export const etapasDoSeed: readonly EtapaDoSeed[] = [
  { nome: 'identidade: contas demo', executar: criarContasDemo },
];
