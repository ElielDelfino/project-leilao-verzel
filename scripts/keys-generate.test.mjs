// Testes de `pnpm keys:generate` (task 010, specs/014 §Segredos, ADR 0015). Rodar: pnpm test:scripts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as ed from '@noble/ed25519';

import { VARIAVEIS, gerarEnvLocal, nomeBackup, nomeTemporario } from './keys-generate.mjs';

const SCRIPT = resolve(import.meta.dirname, 'keys-generate.mjs');
const RAIZ = resolve(import.meta.dirname, '..');
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BYTES_256_BITS = 32;

function lerEnv(caminho) {
  const pares = readFileSync(caminho, 'utf8')
    .split('\n')
    .filter((linha) => linha && !linha.startsWith('#'))
    .map((linha) => {
      const igual = linha.indexOf('=');
      return [linha.slice(0, igual), linha.slice(igual + 1)];
    });
  return Object.fromEntries(pares);
}

function bytes(valorBase64url) {
  return Buffer.from(valorBase64url, 'base64url');
}

function rodarCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function git(cwd, args) {
  const saida = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (saida.error) throw saida.error;
  return saida;
}

// Repositório git descartável com o .gitignore informado.
function repoTemporario(pai, gitignore) {
  const repo = mkdtempSync(join(pai, 'repo-'));
  assert.equal(git(repo, ['init', '-q']).status, 0);
  writeFileSync(join(repo, '.gitignore'), gitignore);
  return repo;
}

const ignoradoNoRepo = (relativo) => git(RAIZ, ['check-ignore', '-q', '--', relativo]).status === 0;

describe('keys:generate', () => {
  let dir;
  const novoCaminho = (nome) => join(dir, nome);

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'keys-generate-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('cria o arquivo com as 7 variáveis da tarefa, sem valor vazio', async () => {
    const caminho = novoCaminho('cria.env');

    const resultado = await gerarEnvLocal({ caminho });

    assert.equal(resultado.status, 'criado');
    const env = lerEnv(caminho);
    assert.deepEqual(Object.keys(env).sort(), [...VARIAVEIS].sort());
    assert.deepEqual([...VARIAVEIS].sort(), [
      'DB_PASSWORD',
      'ED25519_KEY_ID',
      'ED25519_PRIVATE_KEY',
      'JWT_SECRET',
      'PSEUDONYM_HMAC_KEY',
      'REDIS_PASSWORD',
      'SEED_DEMO_PASSWORD',
    ]);
    for (const nome of VARIAVEIS) assert.ok(env[nome].length > 0, `${nome} vazio`);
  });

  it('grava o arquivo com permissão 600', async () => {
    const caminho = novoCaminho('permissao.env');

    await gerarEnvLocal({ caminho });

    assert.equal(statSync(caminho).mode & 0o777, 0o600);
  });

  it('gera JWT_SECRET, PSEUDONYM_HMAC_KEY e as senhas de banco com 256 bits em base64url', async () => {
    const caminho = novoCaminho('tamanhos.env');

    await gerarEnvLocal({ caminho });

    const env = lerEnv(caminho);
    for (const nome of ['JWT_SECRET', 'PSEUDONYM_HMAC_KEY', 'DB_PASSWORD', 'REDIS_PASSWORD']) {
      assert.match(env[nome], BASE64URL, `${nome} fora de base64url`);
      assert.equal(bytes(env[nome]).length, BYTES_256_BITS, `${nome} sem 256 bits`);
    }
  });

  it('gera SEED_DEMO_PASSWORD dentro da regra de senha do cadastro (10 a 128 caracteres)', async () => {
    const caminho = novoCaminho('seed.env');

    await gerarEnvLocal({ caminho });

    const senha = lerEnv(caminho).SEED_DEMO_PASSWORD;
    assert.match(senha, BASE64URL);
    assert.ok(senha.length >= 10 && senha.length <= 128, `tamanho ${senha.length}`);
  });

  it('gera uma chave Ed25519 válida e um ED25519_KEY_ID derivado da chave pública', async () => {
    const caminho = novoCaminho('ed25519.env');

    await gerarEnvLocal({ caminho });

    const env = lerEnv(caminho);
    const chavePrivada = bytes(env.ED25519_PRIVATE_KEY);
    assert.match(env.ED25519_PRIVATE_KEY, BASE64URL);
    assert.equal(chavePrivada.length, BYTES_256_BITS);
    const chavePublica = await ed.getPublicKeyAsync(chavePrivada);
    const mensagem = new TextEncoder().encode('leilao-verzel:teste');
    const assinatura = await ed.signAsync(mensagem, chavePrivada);
    assert.equal(await ed.verifyAsync(assinatura, mensagem, chavePublica), true);
    const esperado = createHash('sha256').update(chavePublica).digest('hex').slice(0, 16);
    assert.equal(env.ED25519_KEY_ID, esperado);
  });

  it('gera valores diferentes a cada arquivo novo', async () => {
    const a = novoCaminho('aleatorio-a.env');
    const b = novoCaminho('aleatorio-b.env');

    await gerarEnvLocal({ caminho: a });
    await gerarEnvLocal({ caminho: b });

    const envA = lerEnv(a);
    const envB = lerEnv(b);
    for (const nome of VARIAVEIS) assert.notEqual(envA[nome], envB[nome], `${nome} repetido`);
  });

  it('rodar duas vezes sem --force não altera o arquivo', async () => {
    const caminho = novoCaminho('duas-vezes.env');
    await gerarEnvLocal({ caminho });
    const antes = readFileSync(caminho);

    const resultado = await gerarEnvLocal({ caminho });

    assert.equal(resultado.status, 'mantido');
    assert.deepEqual(readFileSync(caminho), antes);
  });

  it('com --force regera todos os valores e mantém a permissão 600', async () => {
    const caminho = novoCaminho('force.env');
    await gerarEnvLocal({ caminho });
    const antes = lerEnv(caminho);

    const resultado = await gerarEnvLocal({ caminho, forcar: true });

    assert.equal(resultado.status, 'sobrescrito');
    const depois = lerEnv(caminho);
    for (const nome of VARIAVEIS) assert.notEqual(depois[nome], antes[nome], `${nome} igual`);
    assert.equal(statSync(caminho).mode & 0o777, 0o600);
  });

  it('não deixa arquivo temporário no diretório', async () => {
    const sub = mkdtempSync(join(dir, 'limpo-'));
    const caminho = join(sub, '.env.local');

    await gerarEnvLocal({ caminho });
    const { backup } = await gerarEnvLocal({ caminho, forcar: true });

    assert.deepEqual(readdirSync(sub).sort(), ['.env.local', basename(backup)].sort());
  });

  describe('backup no --force', () => {
    it('guarda o arquivo anterior intacto, com permissão 600', async () => {
      const caminho = novoCaminho('backup.env');
      await gerarEnvLocal({ caminho });
      const anterior = readFileSync(caminho);

      const { backup } = await gerarEnvLocal({ caminho, forcar: true });

      assert.ok(backup, 'sem caminho de backup');
      assert.deepEqual(readFileSync(backup), anterior);
      assert.equal(statSync(backup).mode & 0o777, 0o600);
      assert.notDeepEqual(readFileSync(caminho), anterior);
    });

    it('dois --force seguidos geram backups distintos', async () => {
      const caminho = novoCaminho('backup-duplo.env');
      await gerarEnvLocal({ caminho });

      const primeiro = await gerarEnvLocal({ caminho, forcar: true });
      const segundo = await gerarEnvLocal({ caminho, forcar: true });

      assert.notEqual(primeiro.backup, segundo.backup);
      assert.ok(existsSync(primeiro.backup) && existsSync(segundo.backup));
    });

    it('não cria backup quando o arquivo ainda não existia', async () => {
      const sub = mkdtempSync(join(dir, 'sem-backup-'));

      const resultado = await gerarEnvLocal({ caminho: join(sub, '.env.local'), forcar: true });

      assert.equal(resultado.status, 'criado');
      assert.equal(resultado.backup, undefined);
      assert.deepEqual(readdirSync(sub), ['.env.local']);
    });
  });

  describe('.gitignore do repositório', () => {
    it('ignora o .env.local, o temporário e o backup que o script cria na raiz', () => {
      const alvo = join(RAIZ, '.env.local');
      const nomes = [alvo, nomeTemporario(alvo), nomeBackup(alvo)].map((c) => basename(c));

      for (const nome of nomes) assert.ok(ignoradoNoRepo(nome), `${nome} versionável`);
    });
  });

  describe('destino versionável', () => {
    it('recusa um caminho dentro deste repositório que não é ignorado', async () => {
      const caminho = join(RAIZ, 'scripts', 'segredos-teste-keys-generate.txt');
      try {
        await assert.rejects(gerarEnvLocal({ caminho }), /versionad/);
        assert.equal(existsSync(caminho), false);
      } finally {
        rmSync(caminho, { force: true });
      }
    });

    it('recusa um caminho não ignorado em outro repositório git', async () => {
      const repo = repoTemporario(dir, '');
      const caminho = join(repo, 'segredos.txt');

      await assert.rejects(gerarEnvLocal({ caminho }), /versionad/);

      assert.deepEqual(readdirSync(repo).sort(), ['.git', '.gitignore']);
    });

    it('recusa quando o alvo é ignorado mas o temporário não é', async () => {
      const repo = repoTemporario(dir, 'meu.env\n');

      await assert.rejects(gerarEnvLocal({ caminho: join(repo, 'meu.env') }), /versionad/);

      assert.deepEqual(readdirSync(repo).sort(), ['.git', '.gitignore']);
    });

    it('aceita um caminho ignorado pelo git, com temporário e backup também ignorados', async () => {
      const repo = repoTemporario(dir, '.env.local\n.env.*.local\n');
      const caminho = join(repo, '.env.local');

      await gerarEnvLocal({ caminho });
      const { backup } = await gerarEnvLocal({ caminho, forcar: true });

      assert.ok(existsSync(caminho) && existsSync(backup));
    });

    it('recusa um arquivo já versionado, mesmo que o padrão o ignore', async () => {
      const repo = repoTemporario(dir, '.env.*.local\n');
      const caminho = join(repo, '.env.local');
      writeFileSync(caminho, 'X=1\n');
      assert.equal(git(repo, ['add', '.env.local']).status, 0);
      writeFileSync(join(repo, '.gitignore'), '.env.local\n.env.*.local\n');

      await assert.rejects(gerarEnvLocal({ caminho, forcar: true }), /versionad/);

      assert.equal(readFileSync(caminho, 'utf8'), 'X=1\n');
    });

    it('recusa diretório de destino inexistente', async () => {
      const caminho = join(dir, 'nao-existe', '.env.local');

      await assert.rejects(gerarEnvLocal({ caminho }), /diretório/);
    });
  });

  describe('alvo que não é arquivo comum', () => {
    it('recusa link simbólico pendente sem criar nada', async () => {
      const sub = mkdtempSync(join(dir, 'link-pendente-'));
      const caminho = join(sub, '.env.local');
      symlinkSync(join(sub, 'nao-existe'), caminho);

      await assert.rejects(gerarEnvLocal({ caminho, forcar: true }), /arquivo comum/);

      assert.deepEqual(readdirSync(sub), ['.env.local']);
    });

    it('recusa link simbólico para arquivo existente sem alterá-lo', async () => {
      const sub = mkdtempSync(join(dir, 'link-'));
      const real = join(sub, 'real.env');
      writeFileSync(real, 'X=1\n');
      const caminho = join(sub, '.env.local');
      symlinkSync(real, caminho);

      await assert.rejects(gerarEnvLocal({ caminho, forcar: true }), /arquivo comum/);

      assert.equal(readFileSync(real, 'utf8'), 'X=1\n');
    });
  });

  describe('CLI', () => {
    it('não imprime nenhum valor ao criar, ao manter e ao sobrescrever', () => {
      const caminho = novoCaminho('cli.env');
      const saidas = [];

      saidas.push(rodarCli(['--out', caminho]));
      const primeiro = lerEnv(caminho);
      saidas.push(rodarCli(['--out', caminho]));
      saidas.push(rodarCli(['--out', caminho, '--force']));
      const segundo = lerEnv(caminho);

      for (const saida of saidas) assert.equal(saida.status, 0, saida.stderr);
      const terminal = saidas.map((s) => s.stdout + s.stderr).join('\n');
      for (const env of [primeiro, segundo]) {
        for (const nome of VARIAVEIS) {
          assert.ok(!terminal.includes(env[nome]), `valor de ${nome} apareceu no terminal`);
        }
      }
    });

    it('sem --force, a segunda execução sai com 0 e não altera o arquivo', () => {
      const caminho = novoCaminho('cli-duas-vezes.env');
      rodarCli(['--out', caminho]);
      const antes = readFileSync(caminho);

      const saida = rodarCli(['--out', caminho]);

      assert.equal(saida.status, 0);
      assert.match(saida.stdout, /--force/);
      assert.deepEqual(readFileSync(caminho), antes);
    });

    it('recusa argumento desconhecido sem criar o arquivo', () => {
      const caminho = novoCaminho('cli-invalido.env');

      const saida = rodarCli(['--out', caminho, '--forca']);

      assert.notEqual(saida.status, 0);
      assert.match(saida.stderr, /--forca/);
      assert.equal(existsSync(caminho), false);
    });

    it('no --force, cita o caminho do backup e não os valores', () => {
      const caminho = novoCaminho('cli-backup.env');
      rodarCli(['--out', caminho]);
      const anterior = lerEnv(caminho);

      const saida = rodarCli(['--out', caminho, '--force']);

      assert.equal(saida.status, 0, saida.stderr);
      const backup = /(\S*\.env\.bak-\S+\.local)/.exec(saida.stdout)?.[1];
      assert.ok(backup, `backup não citado: ${saida.stdout}`);
      assert.deepEqual(lerEnv(backup), anterior);
      for (const nome of VARIAVEIS) assert.ok(!saida.stdout.includes(anterior[nome]), nome);
    });

    it('recusa --out versionável com código ≠ 0 sem gravar nada', () => {
      const repo = repoTemporario(dir, '');
      const caminho = join(repo, 'segredos.txt');

      const saida = rodarCli(['--out', caminho]);

      assert.notEqual(saida.status, 0);
      assert.match(saida.stderr, /versionad/);
      assert.deepEqual(readdirSync(repo).sort(), ['.git', '.gitignore']);
    });

    it('recusa --out sem caminho', () => {
      const saida = rodarCli(['--out']);

      assert.notEqual(saida.status, 0);
      assert.match(saida.stderr, /--out/);
    });
  });
});
