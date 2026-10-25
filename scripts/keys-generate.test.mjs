// Testes de `pnpm keys:generate` (tasks 010 e 023, specs/014 §Segredos, ADR 0023). Rodar: pnpm test:scripts
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
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

import { sincronizarSenha, verificadorScram } from './db-sync-password.mjs';
import {
  DIRETORIO_DE_SEGREDOS,
  SEGREDOS_EM_ARQUIVO,
  UID_DA_API,
  VARIAVEIS,
  VARIAVEIS_OBSOLETAS,
  gerarEnvLocal,
  nomeBackup,
  nomeBackupDeSegredo,
  nomeTemporario,
} from './keys-generate.mjs';

const SCRIPT = resolve(import.meta.dirname, 'keys-generate.mjs');
const RAIZ = resolve(import.meta.dirname, '..');
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BYTES_256_BITS = 32;
// 32 bytes em base64url sem padding (ADR 0023 §Decisão, item 4).
const CARACTERES_DO_SEGREDO = 43;
const ARQUIVOS_DE_SEGREDO = Object.values(SEGREDOS_EM_ARQUIVO).sort();
const modo = (caminho) => statSync(caminho).mode & 0o777;

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

  it('cria o arquivo com os 5 segredos da ADR 0023, sem valor vazio', async () => {
    const caminho = novoCaminho('cria.env');

    const resultado = await gerarEnvLocal({ caminho });

    assert.equal(resultado.status, 'criado');
    const env = lerEnv(caminho);
    assert.deepEqual(Object.keys(env).sort(), [...VARIAVEIS].sort());
    assert.deepEqual([...VARIAVEIS].sort(), [
      'DB_PASSWORD',
      'ED25519_PRIVATE_KEY',
      'JWT_SECRET',
      'PSEUDONYM_HMAC_KEY',
      'REDIS_PASSWORD',
    ]);
    for (const nome of VARIAVEIS) assert.ok(env[nome].length > 0, `${nome} vazio`);
  });

  it('não gera ED25519_KEY_ID nem SEED_DEMO_PASSWORD (ADR 0023, itens 5 e 6)', async () => {
    const caminho = novoCaminho('sem-obsoletas.env');

    await gerarEnvLocal({ caminho });

    const env = lerEnv(caminho);
    assert.deepEqual([...VARIAVEIS_OBSOLETAS].sort(), ['ED25519_KEY_ID', 'SEED_DEMO_PASSWORD']);
    for (const nome of VARIAVEIS_OBSOLETAS) assert.equal(env[nome], undefined, `${nome} gerado`);
  });

  it('gera os 5 segredos em base64url canônico de 43 caracteres (ADR 0023, item 4)', async () => {
    const caminho = novoCaminho('canonico.env');

    await gerarEnvLocal({ caminho });

    const env = lerEnv(caminho);
    for (const nome of VARIAVEIS) {
      assert.equal(env[nome].length, CARACTERES_DO_SEGREDO, `${nome} sem 43 caracteres`);
      assert.equal(bytes(env[nome]).toString('base64url'), env[nome], `${nome} não canônico`);
    }
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

  it('gera uma seed Ed25519 válida (RFC 8032 §5.1.5) que assina e verifica', async () => {
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

  describe('permissões de arquivos que já existiam (task 023)', () => {
    // .secrets/ com 755 e arquivos com 644, com o conteúdo esperado: o cenário do MEDIUM 1.
    async function preCriarAbertos(sub) {
      const caminho = join(sub, '.env.local');
      await gerarEnvLocal({ caminho });
      const diretorio = join(sub, DIRETORIO_DE_SEGREDOS);
      chmodSync(diretorio, 0o755);
      for (const variavel of Object.keys(SEGREDOS_EM_ARQUIVO)) {
        chmodSync(caminhoDoSegredo(caminho, variavel), 0o644);
      }
      chmodSync(caminho, 0o644);
      return { caminho, diretorio };
    }

    it('volta para 700 um .secrets/ existente com 755 e para 600 os arquivos mantidos com 644', async () => {
      const { caminho, diretorio } = await preCriarAbertos(mkdtempSync(join(dir, 'abertos-')));
      const conteudos = Object.keys(SEGREDOS_EM_ARQUIVO).map((v) => lerSegredo(caminho, v));

      const resultado = await gerarEnvLocal({ caminho });

      assert.equal(modo(diretorio), 0o700);
      for (const segredo of resultado.segredos) {
        assert.equal(segredo.status, 'mantido');
        assert.equal(segredo.permissaoCorrigida, true, `${segredo.variavel} sem correção`);
        assert.equal(
          modo(segredo.caminho),
          0o600,
          `${segredo.variavel} com ${modo(segredo.caminho)}`,
        );
      }
      const depois = Object.keys(SEGREDOS_EM_ARQUIVO).map((v) => lerSegredo(caminho, v));
      assert.deepEqual(depois, conteudos);
    });

    it('volta para 600 um .env.local mantido com 644, sem alterar o conteúdo', async () => {
      const { caminho } = await preCriarAbertos(mkdtempSync(join(dir, 'env-aberto-')));
      const antes = readFileSync(caminho);

      const resultado = await gerarEnvLocal({ caminho });

      assert.equal(resultado.status, 'mantido');
      assert.equal(resultado.permissaoCorrigida, true);
      assert.equal(modo(caminho), 0o600);
      assert.deepEqual(readFileSync(caminho), antes);
    });

    it('não marca correção quando as permissões já estão certas', async () => {
      const sub = mkdtempSync(join(dir, 'ja-fechados-'));
      const caminho = join(sub, '.env.local');
      await gerarEnvLocal({ caminho });

      const resultado = await gerarEnvLocal({ caminho });

      assert.equal(resultado.permissaoCorrigida, undefined);
      for (const segredo of resultado.segredos) assert.equal(segredo.permissaoCorrigida, undefined);
    });

    it('com --force, volta para 700 um .secrets/ existente com 755', async () => {
      const { caminho, diretorio } = await preCriarAbertos(
        mkdtempSync(join(dir, 'abertos-force-')),
      );

      const resultado = await gerarEnvLocal({ caminho, forcar: true });

      assert.equal(modo(diretorio), 0o700);
      for (const segredo of resultado.segredos) assert.equal(modo(segredo.caminho), 0o600);
      assert.equal(modo(caminho), 0o600);
    });

    it('a CLI diz que corrigiu a permissão, sem citar valores', async () => {
      const { caminho } = await preCriarAbertos(mkdtempSync(join(dir, 'cli-abertos-')));
      const env = lerEnv(caminho);

      const saida = rodarCli(['--out', caminho]);

      assert.equal(saida.status, 0, saida.stderr);
      assert.match(saida.stdout, /db_password \(mantido, permissão corrigida para 600\)/);
      assert.match(saida.stdout, /\.secrets.*700/);
      assert.match(saida.stdout, /permissão corrigida para 600/);
      for (const nome of VARIAVEIS) assert.ok(!saida.stdout.includes(env[nome]), nome);
    });
  });

  describe('.env.local antigo com variáveis que saíram (ADR 0023)', () => {
    function envAntigo(sub) {
      const caminho = join(sub, '.env.local');
      const linhas = [
        'DB_PASSWORD=' + 'a'.repeat(CARACTERES_DO_SEGREDO),
        'REDIS_PASSWORD=' + 'b'.repeat(CARACTERES_DO_SEGREDO),
        'ED25519_KEY_ID=valorDoKeyIdAntigo',
        'SEED_DEMO_PASSWORD=valorDaSenhaDemoAntiga',
        '',
      ];
      writeFileSync(caminho, linhas.join('\n'), { mode: 0o600 });
      return caminho;
    }

    it('lista os nomes obsoletos sem alterar o arquivo', async () => {
      const caminho = envAntigo(mkdtempSync(join(dir, 'obsoletas-')));
      const antes = readFileSync(caminho);

      const resultado = await gerarEnvLocal({ caminho });

      assert.equal(resultado.status, 'mantido');
      assert.deepEqual(resultado.obsoletas, ['ED25519_KEY_ID', 'SEED_DEMO_PASSWORD']);
      assert.deepEqual(readFileSync(caminho), antes);
    });

    it('não lista nada num .env.local atual', async () => {
      const caminho = novoCaminho('sem-obsoletas-mantido.env');
      await gerarEnvLocal({ caminho });

      const resultado = await gerarEnvLocal({ caminho });

      assert.equal(resultado.obsoletas, undefined);
    });

    it('a CLI avisa pelos nomes e não mostra os valores', () => {
      const caminho = envAntigo(mkdtempSync(join(dir, 'cli-obsoletas-')));

      const saida = rodarCli(['--out', caminho]);

      assert.equal(saida.status, 0, saida.stderr);
      assert.match(saida.stdout, /ED25519_KEY_ID/);
      assert.match(saida.stdout, /SEED_DEMO_PASSWORD/);
      assert.match(saida.stdout, /sobrescrev/);
      assert.ok(!saida.stdout.includes('valorDoKeyIdAntigo'), 'valor do key id no terminal');
      assert.ok(
        !saida.stdout.includes('valorDaSenhaDemoAntiga'),
        'valor da senha demo no terminal',
      );
    });
  });

  describe('dono dos arquivos de .secrets/ e o uid da API (task 023)', () => {
    it('o uid esperado é o do usuário node da imagem da API', () => {
      assert.equal(UID_DA_API, 1000);
    });

    it('avisa quando o dono dos arquivos não é o uid da API', async () => {
      const caminho = novoCaminho('uid-diferente.env');

      const resultado = await gerarEnvLocal({ caminho, uid: 1001 });

      assert.equal(resultado.donoDiferenteDaApi, true);
    });

    it('não avisa quando o dono é o uid da API', async () => {
      const caminho = novoCaminho('uid-igual.env');

      const resultado = await gerarEnvLocal({ caminho, uid: UID_DA_API });

      assert.equal(resultado.donoDiferenteDaApi, undefined);
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

// `pnpm db:sync-password` (task 023): aplica no volume de dev a senha de .secrets/db_password, o passo
// seguinte a um `keys:generate --force`. Os testes ficam aqui porque o script só existe para esse fluxo.
describe('db:sync-password', () => {
  let dir;
  const SENHA = 'S'.repeat(CARACTERES_DO_SEGREDO - 1) + 'A';
  const OUTRA = 'O'.repeat(CARACTERES_DO_SEGREDO - 1) + 'A';

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'db-sync-password-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function raizCom(senhaNoArquivo) {
    const raiz = mkdtempSync(join(dir, 'raiz-'));
    if (senhaNoArquivo !== undefined) {
      mkdirSync(join(raiz, DIRETORIO_DE_SEGREDOS), { mode: 0o700 });
      writeFileSync(join(raiz, DIRETORIO_DE_SEGREDOS, 'db_password'), senhaNoArquivo, {
        mode: 0o600,
      });
    }
    return raiz;
  }

  // O ALTER ROLE roda `psql` direto no `docker exec`; a conferência roda `sh -c` com o psql no script.
  const ehAlter = (args) => args[0] === 'exec' && args.includes('psql');

  // Docker de mentira: o banco aceita `senhaNoBanco` até um ALTER ROLE trocar pelo verificador novo.
  function dockerFalso({ senhaNoBanco, container = 'abc123', falhaNoAlter, sempreRecusa } = {}) {
    const chamadas = [];
    let alterado = false;
    const executar = (args, { entrada } = {}) => {
      chamadas.push({ args, entrada });
      if (args[0] === 'compose') return { status: 0, stdout: `${container}\n`, stderr: '' };
      if (args[0] === 'inspect') return { status: 0, stdout: '172.18.0.2\n', stderr: '' };
      if (ehAlter(args)) {
        if (falhaNoAlter) return { status: 3, stdout: '', stderr: falhaNoAlter(entrada) };
        alterado = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      const aceita = !sempreRecusa && (alterado || entrada === `${senhaNoBanco}\n`);
      return aceita
        ? { status: 0, stdout: '1\n', stderr: '' }
        : { status: 2, stdout: '', stderr: 'FATAL:  password authentication failed for user' };
    };
    return { executar, chamadas };
  }

  const opcoes = (raiz, docker, extra = {}) => ({
    raiz,
    usuario: 'leilao',
    banco: 'leilao',
    senhaDoEnv: SENHA,
    executar: docker.executar,
    ...extra,
  });

  describe('verificador SCRAM-SHA-256', () => {
    it('reproduz o vetor de teste da RFC 7677 §3 (ServerSignature e StoredKey)', () => {
      const sal = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');

      const verificador = verificadorScram('pencil', { sal, iteracoes: 4096 });

      const [, parametros, chaves] = verificador.split('$');
      assert.equal(parametros, '4096:W22ZaJ0SNY7soEsUEjb6gQ==');
      const [storedKey, serverKey] = chaves.split(':').map((c) => Buffer.from(c, 'base64'));
      const authMessage =
        'n=user,r=rOprNGfwEbeRWgbNEkqO,' +
        'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,' +
        'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
      const serverSignature = createHmac('sha256', serverKey).update(authMessage).digest('base64');
      assert.equal(serverSignature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
      const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
      const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
      const clientKey = Buffer.from(proof.map((byte, i) => byte ^ clientSignature[i]));
      assert.deepEqual(createHash('sha256').update(clientKey).digest(), storedKey);
    });

    it('usa o formato do pg_authid, 4096 iterações e um sal novo a cada chamada', () => {
      const a = verificadorScram(SENHA);
      const b = verificadorScram(SENHA);

      const formato =
        /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
      assert.match(a, formato);
      assert.notEqual(a, b);
      assert.ok(!a.includes(SENHA));
    });
  });

  it('sem trocar nada quando a senha do arquivo já autentica', async () => {
    const docker = dockerFalso({ senhaNoBanco: SENHA });

    const resultado = await sincronizarSenha(opcoes(raizCom(SENHA), docker));

    assert.equal(resultado.status, 'ja-sincronizada');
    assert.ok(!docker.chamadas.some((c) => ehAlter(c.args)), 'rodou ALTER ROLE');
  });

  it('aplica um verificador SCRAM pelo socket e confere a senha por TCP', async () => {
    const docker = dockerFalso({ senhaNoBanco: OUTRA });

    const resultado = await sincronizarSenha(opcoes(raizCom(SENHA), docker));

    assert.equal(resultado.status, 'sincronizada');
    const alter = docker.chamadas.find((c) => ehAlter(c.args));
    assert.match(alter.entrada, /^ALTER ROLE "leilao" PASSWORD 'SCRAM-SHA-256\$4096:[^']+';\n$/);
    assert.ok(!alter.entrada.includes(SENHA), 'senha em claro no SQL');
    assert.ok(!alter.args.includes('-h'), 'ALTER ROLE fora do socket');
    const verificacoes = docker.chamadas.filter((c) => c.args.includes('verificar'));
    assert.equal(verificacoes.length, 2);
    for (const { args } of verificacoes) assert.ok(args.includes('172.18.0.2'), 'sem TCP');
  });

  it('nunca põe a senha nem o verificador no argv do docker', async () => {
    const docker = dockerFalso({ senhaNoBanco: OUTRA });

    await sincronizarSenha(opcoes(raizCom(SENHA), docker));

    for (const { args } of docker.chamadas) {
      const argv = args.join(' ');
      assert.ok(!argv.includes(SENHA), `senha no argv: ${args[0]}`);
      assert.ok(!argv.includes('SCRAM-SHA-256$'), `verificador no argv: ${args[0]}`);
    }
  });

  it('recusa quando o .env.local e .secrets/db_password divergem, sem citar valores nem chamar o docker', async () => {
    const docker = dockerFalso({ senhaNoBanco: OUTRA });

    await assert.rejects(sincronizarSenha(opcoes(raizCom(OUTRA), docker)), (erro) => {
      assert.match(erro.message, /keys:generate/);
      assert.ok(!erro.message.includes(SENHA) && !erro.message.includes(OUTRA), 'valor citado');
      return true;
    });
    assert.equal(docker.chamadas.length, 0);
  });

  it('recusa sem .secrets/db_password', async () => {
    const docker = dockerFalso({});

    await assert.rejects(sincronizarSenha(opcoes(raizCom(undefined), docker)), /db_password/);
    assert.equal(docker.chamadas.length, 0);
  });

  it('recusa sem DB_PASSWORD no ambiente (.env.local)', async () => {
    const docker = dockerFalso({});

    await assert.rejects(
      sincronizarSenha(opcoes(raizCom(SENHA), docker, { senhaDoEnv: undefined })),
      /DB_PASSWORD/,
    );
    assert.equal(docker.chamadas.length, 0);
  });

  it('recusa um arquivo fora do formato (quebra de linha no fim) sem citar o valor', async () => {
    const docker = dockerFalso({});

    await assert.rejects(sincronizarSenha(opcoes(raizCom(`${SENHA}\n`), docker)), (erro) => {
      assert.match(erro.message, /db_password/);
      assert.ok(!erro.message.includes(SENHA), 'valor citado');
      return true;
    });
  });

  it('recusa um POSTGRES_USER que não é identificador simples', async () => {
    const docker = dockerFalso({});

    await assert.rejects(
      sincronizarSenha(opcoes(raizCom(SENHA), docker, { usuario: 'leilao"; DROP ROLE x; --' })),
      /POSTGRES_USER/,
    );
    assert.equal(docker.chamadas.length, 0);
  });

  it('recusa quando o Postgres de dev não está rodando', async () => {
    const docker = dockerFalso({ container: '' });

    await assert.rejects(sincronizarSenha(opcoes(raizCom(SENHA), docker)), /infra:up/);
  });

  it('falha se a senha ainda não autentica depois do ALTER ROLE', async () => {
    const docker = dockerFalso({ sempreRecusa: true });

    await assert.rejects(sincronizarSenha(opcoes(raizCom(SENHA), docker)), /não autentic/);
  });

  it('não repassa o verificador nem a senha que apareçam no erro do psql', async () => {
    const docker = dockerFalso({
      senhaNoBanco: OUTRA,
      falhaNoAlter: (sql) => `psql:<stdin>:1: ERROR:  algo deu errado perto de ${sql} ${SENHA}`,
    });

    await assert.rejects(sincronizarSenha(opcoes(raizCom(SENHA), docker)), (erro) => {
      assert.match(erro.message, /ALTER ROLE falhou/);
      assert.ok(!erro.message.includes('SCRAM-SHA-256$'), 'verificador no erro');
      assert.ok(!erro.message.includes(SENHA), 'senha no erro');
      return true;
    });
  });
});
