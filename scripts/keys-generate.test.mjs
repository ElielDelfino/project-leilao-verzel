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
import { basename, dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as ed from '@noble/ed25519';

import {
  DIRETORIO_DE_SEGREDOS,
  SEGREDOS_EM_ARQUIVO,
  VARIAVEIS,
  gerarEnvLocal,
  nomeBackup,
  nomeBackupDeSegredo,
  nomeTemporario,
} from './keys-generate.mjs';

const SCRIPT = resolve(import.meta.dirname, 'keys-generate.mjs');
const RAIZ = resolve(import.meta.dirname, '..');
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BYTES_256_BITS = 32;
const ARQUIVOS_DE_SEGREDO = Object.values(SEGREDOS_EM_ARQUIVO).sort();

// Caminho do arquivo de segredo (Compose `secrets:`) ao lado do .env informado.
const caminhoDoSegredo = (caminhoDoEnv, variavel) =>
  join(dirname(caminhoDoEnv), DIRETORIO_DE_SEGREDOS, SEGREDOS_EM_ARQUIVO[variavel]);

const lerSegredo = (caminhoDoEnv, variavel) =>
  readFileSync(caminhoDoSegredo(caminhoDoEnv, variavel), 'utf8');

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
    const { backup, segredos } = await gerarEnvLocal({ caminho, forcar: true });

    assert.deepEqual(
      readdirSync(sub).sort(),
      ['.env.local', DIRETORIO_DE_SEGREDOS, basename(backup)].sort(),
    );
    const backupsDeSegredo = segredos.map((segredo) => basename(segredo.backup));
    assert.deepEqual(
      readdirSync(join(sub, DIRETORIO_DE_SEGREDOS)).sort(),
      [...ARQUIVOS_DE_SEGREDO, ...backupsDeSegredo].sort(),
    );
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
      assert.deepEqual(readdirSync(sub).sort(), ['.env.local', DIRETORIO_DE_SEGREDOS].sort());
      assert.deepEqual(readdirSync(join(sub, DIRETORIO_DE_SEGREDOS)).sort(), ARQUIVOS_DE_SEGREDO);
      for (const segredo of resultado.segredos) assert.equal(segredo.backup, undefined);
    });
  });

  describe('arquivos de segredo do Compose (.secrets/)', () => {
    it('grava DB_PASSWORD e REDIS_PASSWORD em arquivos 600, num diretório 700, sem quebra de linha', async () => {
      const sub = mkdtempSync(join(dir, 'segredos-'));
      const caminho = join(sub, '.env.local');

      const resultado = await gerarEnvLocal({ caminho });

      const env = lerEnv(caminho);
      assert.deepEqual(Object.keys(SEGREDOS_EM_ARQUIVO).sort(), ['DB_PASSWORD', 'REDIS_PASSWORD']);
      for (const variavel of Object.keys(SEGREDOS_EM_ARQUIVO)) {
        assert.equal(lerSegredo(caminho, variavel), env[variavel], `${variavel} diverge`);
        assert.equal(statSync(caminhoDoSegredo(caminho, variavel)).mode & 0o777, 0o600);
      }
      assert.equal(statSync(join(sub, DIRETORIO_DE_SEGREDOS)).mode & 0o777, 0o700);
      assert.deepEqual(
        resultado.segredos.map((segredo) => segredo.status),
        ['criado', 'criado'],
      );
    });

    it('sem --force, recria um arquivo de segredo ausente com o valor do .env.local existente', async () => {
      const sub = mkdtempSync(join(dir, 'segredo-ausente-'));
      const caminho = join(sub, '.env.local');
      await gerarEnvLocal({ caminho });
      const envAntes = readFileSync(caminho);
      rmSync(caminhoDoSegredo(caminho, 'REDIS_PASSWORD'));

      const resultado = await gerarEnvLocal({ caminho });

      assert.equal(resultado.status, 'mantido');
      assert.deepEqual(readFileSync(caminho), envAntes);
      assert.equal(lerSegredo(caminho, 'REDIS_PASSWORD'), lerEnv(caminho).REDIS_PASSWORD);
      const porVariavel = Object.fromEntries(resultado.segredos.map((s) => [s.variavel, s.status]));
      assert.deepEqual(porVariavel, { DB_PASSWORD: 'mantido', REDIS_PASSWORD: 'criado' });
    });

    it('sem --force, mantém intactos os arquivos de segredo iguais ao .env.local', async () => {
      const sub = mkdtempSync(join(dir, 'segredo-igual-'));
      const caminho = join(sub, '.env.local');
      await gerarEnvLocal({ caminho });
      const inode = statSync(caminhoDoSegredo(caminho, 'DB_PASSWORD')).ino;

      const resultado = await gerarEnvLocal({ caminho });

      assert.deepEqual(
        resultado.segredos.map((segredo) => segredo.status),
        ['mantido', 'mantido'],
      );
      assert.equal(statSync(caminhoDoSegredo(caminho, 'DB_PASSWORD')).ino, inode);
    });

    it('sincroniza com o .env.local um arquivo de segredo divergente e guarda o anterior (600)', async () => {
      const sub = mkdtempSync(join(dir, 'segredo-divergente-'));
      const caminho = join(sub, '.env.local');
      await gerarEnvLocal({ caminho });
      writeFileSync(caminhoDoSegredo(caminho, 'DB_PASSWORD'), 'valorAntigo', { mode: 0o600 });

      const resultado = await gerarEnvLocal({ caminho });

      const db = resultado.segredos.find((segredo) => segredo.variavel === 'DB_PASSWORD');
      assert.equal(db.status, 'sobrescrito');
      assert.equal(lerSegredo(caminho, 'DB_PASSWORD'), lerEnv(caminho).DB_PASSWORD);
      assert.equal(readFileSync(db.backup, 'utf8'), 'valorAntigo');
      assert.equal(statSync(db.backup).mode & 0o777, 0o600);
    });

    it('com --force, regrava os arquivos de segredo com os valores novos e guarda os anteriores', async () => {
      const sub = mkdtempSync(join(dir, 'segredo-force-'));
      const caminho = join(sub, '.env.local');
      await gerarEnvLocal({ caminho });
      const anteriores = Object.keys(SEGREDOS_EM_ARQUIVO).map((v) => lerSegredo(caminho, v));

      const resultado = await gerarEnvLocal({ caminho, forcar: true });

      const env = lerEnv(caminho);
      for (const [indice, segredo] of resultado.segredos.entries()) {
        assert.equal(segredo.status, 'sobrescrito');
        assert.equal(lerSegredo(caminho, segredo.variavel), env[segredo.variavel]);
        assert.equal(readFileSync(segredo.backup, 'utf8'), anteriores[indice]);
        assert.equal(statSync(segredo.backup).mode & 0o777, 0o600);
      }
    });

    it('recusa .env.local existente sem DB_PASSWORD em base64url, sem citar o valor', async () => {
      const sub = mkdtempSync(join(dir, 'env-invalido-'));
      const caminho = join(sub, '.env.local');
      writeFileSync(caminho, 'DB_PASSWORD=com espaço\nREDIS_PASSWORD=ok\n', { mode: 0o600 });

      await assert.rejects(gerarEnvLocal({ caminho }), (erro) => {
        assert.match(erro.message, /DB_PASSWORD/);
        assert.ok(!erro.message.includes('com espaço'), 'valor citado no erro');
        return true;
      });

      assert.deepEqual(readdirSync(sub), ['.env.local']);
    });

    it('recusa .secrets que é link simbólico sem gravar nada', async () => {
      const sub = mkdtempSync(join(dir, 'segredos-link-'));
      const alvoDoLink = mkdtempSync(join(dir, 'alvo-do-link-'));
      symlinkSync(alvoDoLink, join(sub, DIRETORIO_DE_SEGREDOS));

      await assert.rejects(gerarEnvLocal({ caminho: join(sub, '.env.local') }), /diretório comum/);

      assert.deepEqual(readdirSync(sub), [DIRETORIO_DE_SEGREDOS]);
      assert.deepEqual(readdirSync(alvoDoLink), []);
    });

    it('recusa arquivo de segredo que é link simbólico sem alterar o destino do link', async () => {
      const sub = mkdtempSync(join(dir, 'segredo-link-'));
      const caminho = join(sub, '.env.local');
      await gerarEnvLocal({ caminho });
      const real = join(sub, 'real.txt');
      writeFileSync(real, 'X');
      rmSync(caminhoDoSegredo(caminho, 'DB_PASSWORD'));
      symlinkSync(real, caminhoDoSegredo(caminho, 'DB_PASSWORD'));

      await assert.rejects(gerarEnvLocal({ caminho, forcar: true }), /arquivo comum/);

      assert.equal(readFileSync(real, 'utf8'), 'X');
    });
  });

  describe('.gitignore do repositório', () => {
    it('ignora o .env.local, o temporário e o backup que o script cria na raiz', () => {
      const alvo = join(RAIZ, '.env.local');
      const nomes = [alvo, nomeTemporario(alvo), nomeBackup(alvo)].map((c) => basename(c));

      for (const nome of nomes) assert.ok(ignoradoNoRepo(nome), `${nome} versionável`);
    });

    it('ignora os arquivos de segredo, seus temporários e backups em .secrets/', () => {
      const relativos = ARQUIVOS_DE_SEGREDO.flatMap((arquivo) => {
        const alvo = join(RAIZ, DIRETORIO_DE_SEGREDOS, arquivo);
        return [alvo, nomeTemporario(alvo), nomeBackupDeSegredo(alvo)].map(
          (c) => `${DIRETORIO_DE_SEGREDOS}/${basename(c)}`,
        );
      });

      for (const relativo of relativos)
        assert.ok(ignoradoNoRepo(relativo), `${relativo} versionável`);
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

    it('aceita um caminho ignorado pelo git, com temporário, backup e .secrets/ também ignorados', async () => {
      const repo = repoTemporario(dir, '.env.local\n.env.*.local\n.secrets/\n');
      const caminho = join(repo, '.env.local');

      await gerarEnvLocal({ caminho });
      const { backup } = await gerarEnvLocal({ caminho, forcar: true });

      assert.ok(existsSync(caminho) && existsSync(backup));
      assert.ok(existsSync(caminhoDoSegredo(caminho, 'DB_PASSWORD')));
    });

    it('recusa quando o .env.local é ignorado mas .secrets/ não é, sem gravar nada', async () => {
      const repo = repoTemporario(dir, '.env.local\n.env.*.local\n');

      await assert.rejects(gerarEnvLocal({ caminho: join(repo, '.env.local') }), /versionad/);

      assert.deepEqual(readdirSync(repo).sort(), ['.git', '.gitignore']);
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

    it('cita os arquivos de segredo e o backup deles pelo caminho, sem os valores', () => {
      const sub = mkdtempSync(join(dir, 'cli-segredos-'));
      const caminho = join(sub, '.env.local');
      rodarCli(['--out', caminho]);
      const anterior = lerEnv(caminho);

      const saida = rodarCli(['--out', caminho, '--force']);

      assert.equal(saida.status, 0, saida.stderr);
      for (const arquivo of ARQUIVOS_DE_SEGREDO) {
        assert.match(saida.stdout, new RegExp(`${DIRETORIO_DE_SEGREDOS}/${arquivo}`));
        assert.match(saida.stdout, new RegExp(`${DIRETORIO_DE_SEGREDOS}/${arquivo}\\.bak-`));
      }
      const atual = lerEnv(caminho);
      for (const variavel of Object.keys(SEGREDOS_EM_ARQUIVO)) {
        assert.ok(!saida.stdout.includes(anterior[variavel]), `${variavel} antigo no terminal`);
        assert.ok(!saida.stdout.includes(atual[variavel]), `${variavel} novo no terminal`);
      }
    });

    it('recusa --out sem caminho', () => {
      const saida = rodarCli(['--out']);

      assert.notEqual(saida.status, 0);
      assert.match(saida.stderr, /--out/);
    });
  });
});
