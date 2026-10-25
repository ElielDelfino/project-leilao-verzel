// Testes da lógica pura do scripts/verify.mjs (tarefa 032, specs/013 §"Dois níveis de verificação").
// Rodam com `pnpm test:scripts` (node:test). Nenhum teste precisa de Postgres nem de rede; os de git
// usam repositórios temporários próprios.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  ambienteDoRepositorio,
  arquivosAlterados,
  baseDaComparacao,
  formatarTempo,
  lerArgumentos,
  lerPacotes,
  mudouContrato,
  pacotesAfetados,
  pacotesSemTypecheck,
  testesExplicitos,
  testesRelacionados,
  variaveisFaltandoParaOE2e,
} from './verify.mjs';

// ---------------------------------------------------------------- fixtures

const temporarios = [];
afterEach(() => {
  for (const pasta of temporarios.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function pastaTemporaria() {
  const pasta = mkdtempSync(join(tmpdir(), 'leilao-t032-'));
  temporarios.push(pasta);
  return pasta;
}

function escrever(raiz, arquivos) {
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }
}

const manifesto = (dados) => JSON.stringify(dados);

/** Monorepo mínimo: api (TS, Vitest) depende de contracts; web (TS, Vitest) depende de contracts. */
function criarWorkspace(extra = {}) {
  const raiz = pastaTemporaria();
  escrever(raiz, {
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - packages/*\n\nallowBuilds:\n  x: false\n",
    'apps/api/package.json': manifesto({
      name: '@t/api',
      scripts: { typecheck: 'tsc' },
      dependencies: { '@t/contracts': 'workspace:*' },
      devDependencies: { vitest: '1' },
    }),
    'apps/api/src/a.ts': '',
    'apps/web/package.json': manifesto({
      name: '@t/web',
      scripts: { typecheck: 'tsc' },
      devDependencies: { vitest: '1', '@t/contracts': 'workspace:*' },
    }),
    'apps/web/src/b.tsx': '',
    'packages/contracts/package.json': manifesto({
      name: '@t/contracts',
      scripts: { typecheck: 'tsc' },
    }),
    'packages/contracts/src/index.ts': '',
    'packages/solto/package.json': manifesto({ name: '@t/solto' }),
    'packages/solto/README.md': '',
    ...extra,
  });
  return raiz;
}

// ---------------------------------------------------------------- argumentos

describe('lerArgumentos', () => {
  it('quick sem argumentos', () => {
    assert.deepEqual(lerArgumentos(['quick']), {
      modo: 'quick',
      arquivos: [],
      nome: undefined,
      base: undefined,
      e2e: false,
    });
  });

  it('quick com arquivos, -t e --base; o "--" do pnpm é ignorado', () => {
    const opcoes = lerArgumentos([
      'quick',
      '--',
      'a.test.ts',
      'b.test.ts',
      '-t',
      'meu teste',
      '--base',
      'dev',
    ]);
    assert.deepEqual(opcoes.arquivos, ['a.test.ts', 'b.test.ts']);
    assert.equal(opcoes.nome, 'meu teste');
    assert.equal(opcoes.base, 'dev');
  });

  it('aceita --testNamePattern como -t, com espaço ou "="', () => {
    assert.equal(lerArgumentos(['quick', '--testNamePattern', 'x']).nome, 'x');
    assert.equal(lerArgumentos(['quick', '--testNamePattern=a=b']).nome, 'a=b');
  });

  it('full com --e2e', () => {
    const opcoes = lerArgumentos(['full', '--e2e']);
    assert.equal(opcoes.modo, 'full');
    assert.equal(opcoes.e2e, true);
  });

  it('recusa modo ausente ou desconhecido, com o uso', () => {
    assert.throws(() => lerArgumentos([]), /modo inválido: ""[\s\S]*uso:/);
    assert.throws(() => lerArgumentos(['rapido']), /modo inválido: "rapido"/);
  });

  it('recusa opção desconhecida e opção sem valor', () => {
    assert.throws(() => lerArgumentos(['quick', '--tudo']), /opção desconhecida: --tudo/);
    assert.throws(() => lerArgumentos(['quick', '-t']), /-t precisa de um valor/);
    assert.throws(() => lerArgumentos(['quick', '--base']), /--base precisa de um valor/);
  });

  it('arquivos, -t e --base são só do quick', () => {
    assert.throws(() => lerArgumentos(['full', 'a.test.ts']), /só do quick/);
    assert.throws(() => lerArgumentos(['full', '-t', 'x']), /só do quick/);
    assert.throws(() => lerArgumentos(['full', '--base', 'main']), /só do quick/);
  });

  it('--e2e é só do full', () => {
    assert.throws(() => lerArgumentos(['quick', '--e2e']), /--e2e é só do verify:full/);
  });
});

// ---------------------------------------------------------------- ambiente

describe('ambienteDoRepositorio', () => {
  it('o ambiente já definido vence o .env.local, que vence o .env', () => {
    const raiz = pastaTemporaria();
    escrever(raiz, {
      '.env': 'A=env\nB=env\nC=env\nD=env\n',
      '.env.local': 'B=local\nC=local\nE="com espaço"\n',
    });

    const ambiente = ambienteDoRepositorio(raiz, { C: 'processo' });

    assert.deepEqual(ambiente, { A: 'env', B: 'local', C: 'processo', D: 'env', E: 'com espaço' });
  });

  it('funciona sem .env nem .env.local', () => {
    assert.deepEqual(ambienteDoRepositorio(pastaTemporaria(), { X: '1' }), { X: '1' });
  });

  it('um valor vazio no processo ainda vence (é do ambiente)', () => {
    const raiz = pastaTemporaria();
    escrever(raiz, { '.env': 'A=env\n' });

    assert.equal(ambienteDoRepositorio(raiz, { A: '' }).A, '');
  });
});

// ---------------------------------------------------------------- pacotes

describe('lerPacotes e pacotesSemTypecheck', () => {
  it('lê só as pastas com package.json dos padrões do workspace, ignorando o resto do YAML', () => {
    const pacotes = lerPacotes(criarWorkspace({ 'apps/sem-manifesto/src/x.ts': '' }));

    assert.deepEqual(
      pacotes.map((p) => p.pasta),
      ['apps/api', 'apps/web', 'packages/contracts', 'packages/solto'],
    );
  });

  it('detecta TypeScript, Vitest e dependências de cada pacote', () => {
    const porNome = Object.fromEntries(lerPacotes(criarWorkspace()).map((p) => [p.nome, p]));

    assert.equal(porNome['@t/api'].temTs, true);
    assert.equal(porNome['@t/api'].temVitest, true);
    assert.deepEqual(porNome['@t/api'].dependencias.sort(), ['@t/contracts', 'vitest']);
    assert.equal(porNome['@t/contracts'].temVitest, false);
    assert.equal(porNome['@t/solto'].temTs, false);
  });

  it('node_modules, dist e .d.ts não contam como código TypeScript', () => {
    const raiz = criarWorkspace({
      'packages/solto/node_modules/x/index.ts': '',
      'packages/solto/dist/index.ts': '',
      'packages/solto/tipos.d.ts': '',
    });

    assert.equal(lerPacotes(raiz).find((p) => p.nome === '@t/solto').temTs, false);
  });

  it('recusa padrão de workspace com "*" no meio', () => {
    const raiz = criarWorkspace({ 'pnpm-workspace.yaml': 'packages:\n  - "a/*/b"\n' });

    assert.throws(() => lerPacotes(raiz), /padrão não suportado: a\/\*\/b/);
  });

  it('a guarda aponta o pacote com TypeScript e sem script typecheck', () => {
    const pacotes = lerPacotes(
      criarWorkspace({
        'packages/solto/src/x.ts': '',
      }),
    );

    assert.deepEqual(pacotesSemTypecheck(pacotes), ['@t/solto']);
  });

  it('a guarda não acusa pacote sem TypeScript nem pacote com o script', () => {
    assert.deepEqual(pacotesSemTypecheck(lerPacotes(criarWorkspace())), []);
  });
});

describe('pacotesAfetados', () => {
  const nomes = (lista) => lista.map((p) => p.nome).sort();
  const pacotes = () => lerPacotes(criarWorkspace());

  it('um arquivo de um pacote afeta o pacote e quem depende dele (dependências e devDependencies)', () => {
    assert.deepEqual(nomes(pacotesAfetados(pacotes(), ['packages/contracts/src/index.ts'])), [
      '@t/api',
      '@t/contracts',
      '@t/web',
    ]);
  });

  it('quem só é dependente não afeta a dependência', () => {
    assert.deepEqual(nomes(pacotesAfetados(pacotes(), ['apps/web/src/b.tsx'])), ['@t/web']);
  });

  it('propaga por dependências transitivas', () => {
    const lista = [
      { pasta: 'a', nome: 'a', dependencias: [] },
      { pasta: 'b', nome: 'b', dependencias: ['a'] },
      { pasta: 'c', nome: 'c', dependencias: ['b'] },
      { pasta: 'd', nome: 'd', dependencias: [] },
    ];

    assert.deepEqual(nomes(pacotesAfetados(lista, ['a/x.ts'])), ['a', 'b', 'c']);
  });

  it('tsconfig.base.json, package.json e pnpm-lock.yaml da raiz afetam todos os pacotes', () => {
    for (const arquivo of ['tsconfig.base.json', 'package.json', 'pnpm-lock.yaml']) {
      assert.equal(pacotesAfetados(pacotes(), [arquivo]).length, 4, arquivo);
    }
  });

  it('arquivo fora de qualquer pacote (docs, specs) não afeta nenhum', () => {
    assert.deepEqual(pacotesAfetados(pacotes(), ['docs/x.md', 'specs/001.md']), []);
  });

  it('o prefixo precisa ser de pasta: apps/api-extra/x não é de apps/api', () => {
    assert.deepEqual(pacotesAfetados(pacotes(), ['apps/api-extra/x.ts']), []);
  });

  it('um package.json de pacote conta como mudança do pacote, não global', () => {
    assert.deepEqual(nomes(pacotesAfetados(pacotes(), ['apps/web/package.json'])), ['@t/web']);
  });
});

// ---------------------------------------------------------------- testes ligados ao que mudou

describe('testesRelacionados', () => {
  const todosExistem = () => true;
  const nenhumExiste = () => false;
  const comVitest = () => lerPacotes(criarWorkspace());
  const como = (mapa) => Object.fromEntries(mapa);

  it('src/x.ts → test/x.test.ts e src/x.tsx → test/x.test.tsx', () => {
    const raiz = criarWorkspace();
    const existentes = new Set(['apps/api/test/a.test.ts', 'apps/web/test/b.test.tsx']);

    const mapa = testesRelacionados(
      raiz,
      lerPacotes(raiz),
      ['apps/api/src/a.ts', 'apps/web/src/b.tsx'],
      (caminho) => existentes.has(caminho),
    );

    assert.deepEqual(como(mapa), {
      'apps/api': ['test/a.test.ts'],
      'apps/web': ['test/b.test.tsx'],
    });
  });

  it('só entra o teste que existe', () => {
    const raiz = criarWorkspace();

    assert.equal(
      testesRelacionados(raiz, lerPacotes(raiz), ['apps/api/src/a.ts'], nenhumExiste).size,
      0,
    );
  });

  it('o próprio teste alterado entra; arquivo apagado (existe=false) fica de fora', () => {
    const raiz = criarWorkspace();
    const pacotes = lerPacotes(raiz);

    assert.deepEqual(
      como(testesRelacionados(raiz, pacotes, ['apps/api/test/x/y.test.ts'], todosExistem)),
      { 'apps/api': ['test/x/y.test.ts'] },
    );
    assert.equal(
      testesRelacionados(raiz, pacotes, ['apps/api/test/x/y.test.ts'], nenhumExiste).size,
      0,
    );
  });

  it('subpastas e nomes com acento e espaço mantêm o caminho', () => {
    const raiz = criarWorkspace();

    const mapa = testesRelacionados(
      raiz,
      lerPacotes(raiz),
      ['apps/api/src/lances/ação x.ts'],
      todosExistem,
    );

    assert.deepEqual(como(mapa), {
      'apps/api': ['test/lances/ação x.test.ts', 'test/lances/ação x.test.tsx'],
    });
  });

  it('arquivos que não são src/*.ts (md, json, .d.ts de fora de src) não ligam a nenhum teste', () => {
    const raiz = criarWorkspace();

    const mapa = testesRelacionados(
      raiz,
      lerPacotes(raiz),
      [
        'apps/api/README.md',
        'apps/api/package.json',
        'apps/api/src/dados.json',
        'apps/api/scripts/x.ts',
      ],
      todosExistem,
    );

    assert.equal(mapa.size, 0);
  });

  it('pacote sem Vitest não recebe testes', () => {
    const raiz = criarWorkspace();

    const mapa = testesRelacionados(
      raiz,
      lerPacotes(raiz),
      ['packages/contracts/src/index.ts'],
      todosExistem,
    );

    assert.equal(mapa.size, 0);
    assert.equal(comVitest().filter((p) => p.temVitest).length, 2);
  });

  it('migrations, setup e helpers de test/db rodam todos os testes de test/db e test/setup da API', () => {
    const raiz = criarWorkspace({
      'apps/api/test/db/um.test.ts': '',
      'apps/api/test/db/sub/dois.test.ts': '',
      'apps/api/test/db/ambiente-de-teste.ts': '',
      'apps/api/test/setup/global.test.ts': '',
      'apps/api/test/outro.test.ts': '',
    });
    const existe = (caminho) => caminho.startsWith('apps/api/test/');

    for (const gatilho of [
      'database/postgres/migrations/0001_x.sql',
      'apps/api/test/setup/global.ts',
      'apps/api/test/db/ambiente-de-teste.ts',
    ]) {
      const mapa = testesRelacionados(raiz, lerPacotes(raiz), [gatilho], existe);
      assert.deepEqual(
        mapa.get('apps/api'),
        ['test/db/sub/dois.test.ts', 'test/db/um.test.ts', 'test/setup/global.test.ts'],
        gatilho,
      );
    }
  });

  it('mudança em outro lugar não dispara os testes de banco', () => {
    const raiz = criarWorkspace({ 'apps/api/test/db/um.test.ts': '' });

    const mapa = testesRelacionados(raiz, lerPacotes(raiz), ['apps/api/src/z.ts'], todosExistem);

    assert.ok(![...mapa.values()].flat().some((t) => t.startsWith('test/db/')));
  });

  it('sem duplicatas e em ordem estável', () => {
    const raiz = criarWorkspace();

    const mapa = testesRelacionados(
      raiz,
      lerPacotes(raiz),
      ['apps/api/src/a.ts', 'apps/api/test/a.test.ts', 'apps/api/src/a.ts'],
      todosExistem,
    );

    assert.deepEqual(mapa.get('apps/api'), ['test/a.test.ts', 'test/a.test.tsx']);
  });
});

describe('testesExplicitos', () => {
  const raiz = () =>
    criarWorkspace({
      'apps/api/test/a.test.ts': '',
      'apps/api/test/setup/g.test.ts': '',
      'apps/web/test/b.test.tsx': '',
      'scripts/verify.test.mjs': '',
      'packages/contracts/test/c.test.ts': '',
    });

  it('agrupa por pacote o caminho da raiz', () => {
    const r = raiz();

    const { porPacote, scripts } = testesExplicitos(
      r,
      lerPacotes(r),
      ['apps/api/test/a.test.ts', 'apps/web/test/b.test.tsx'],
      r,
    );

    assert.deepEqual(
      [...porPacote],
      [
        ['apps/api', ['test/a.test.ts']],
        ['apps/web', ['test/b.test.tsx']],
      ],
    );
    assert.deepEqual(scripts, []);
  });

  it('resolve relativo à pasta de onde o comando foi dado (INIT_CWD) e ao pacote', () => {
    const r = raiz();
    const pacotes = lerPacotes(r);

    const daPastaDoPacote = testesExplicitos(r, pacotes, ['test/a.test.ts'], join(r, 'apps/api'));
    const doPacoteSemCwd = testesExplicitos(r, pacotes, ['test/setup/g.test.ts'], r);

    assert.deepEqual(daPastaDoPacote.porPacote.get('apps/api'), ['test/a.test.ts']);
    assert.deepEqual(doPacoteSemCwd.porPacote.get('apps/api'), ['test/setup/g.test.ts']);
  });

  it('scripts/*.test.mjs vão para o node:test, não para o Vitest', () => {
    const r = raiz();

    const { porPacote, scripts } = testesExplicitos(
      r,
      lerPacotes(r),
      ['scripts/verify.test.mjs'],
      r,
    );

    assert.equal(porPacote.size, 0);
    assert.deepEqual(scripts, ['scripts/verify.test.mjs']);
  });

  it('arquivo inexistente falha com o nome', () => {
    const r = raiz();

    assert.throws(
      () => testesExplicitos(r, lerPacotes(r), ['nao-existe.test.ts'], r),
      /arquivo de teste não encontrado: nao-existe\.test\.ts/,
    );
  });

  it('um diretório não conta como arquivo de teste', () => {
    const r = raiz();

    assert.throws(() => testesExplicitos(r, lerPacotes(r), ['apps/api/test'], r), /não encontrado/);
  });

  it('nome que existe em mais de um pacote é ambíguo e pede o caminho da raiz', () => {
    const r = criarWorkspace({
      'apps/api/test/igual.test.ts': '',
      'apps/web/test/igual.test.ts': '',
    });

    assert.throws(
      () => testesExplicitos(r, lerPacotes(r), ['test/igual.test.ts'], r),
      /arquivo ambíguo: test\/igual\.test\.ts \(apps\/api\/test\/igual\.test\.ts, apps\/web\/test\/igual\.test\.ts\); use o caminho da raiz/,
    );
  });

  it('arquivo de pacote sem Vitest é recusado', () => {
    const r = raiz();

    assert.throws(
      () => testesExplicitos(r, lerPacotes(r), ['packages/contracts/test/c.test.ts'], r),
      /não está num pacote com Vitest nem em scripts\//,
    );
  });
});

describe('formatarTempo', () => {
  it('abaixo de 1 s em ms; acima em segundos com vírgula', () => {
    assert.equal(formatarTempo(0), '0 ms');
    assert.equal(formatarTempo(999.4), '999 ms');
    assert.equal(formatarTempo(1000), '1,0 s');
    assert.equal(formatarTempo(12_340), '12,3 s');
  });
});

// ---------------------------------------------------------------- git (repositórios temporários)

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

/** Repositório com `main` e um primeiro commit; devolve a pasta. */
function criarRepositorio(arquivos = { 'a.txt': 'a\n' }) {
  const raiz = pastaTemporaria();
  git(raiz, 'init', '-q', '-b', 'main');
  escrever(raiz, arquivos);
  git(raiz, 'add', '-A');
  git(raiz, 'commit', '-q', '-m', 'inicial');
  return raiz;
}

function commit(raiz, arquivo, mensagem) {
  escrever(raiz, { [arquivo]: `${mensagem}\n` });
  git(raiz, 'add', '-A');
  git(raiz, 'commit', '-q', '-m', mensagem);
  return git(raiz, 'rev-parse', 'HEAD');
}

describe('arquivosAlterados', () => {
  it('junta commits, alterações, arquivos novos e apagados desde a base, em ordem', () => {
    const raiz = criarRepositorio({
      'a.txt': 'a\n',
      'b.txt': 'b\n',
      'c.txt': 'c\n',
      '.gitignore': 'ignorado.txt\n',
    });
    const base = git(raiz, 'rev-parse', 'HEAD');
    git(raiz, 'switch', '-q', '-c', 'feature');
    commit(raiz, 'commitado.txt', 'commitado');
    escrever(raiz, { 'a.txt': 'mudou\n', 'novo.txt': 'n\n', 'ignorado.txt': 'x\n' });
    rmSync(join(raiz, 'b.txt'));

    assert.deepEqual(arquivosAlterados(base, raiz), [
      'a.txt',
      'b.txt',
      'commitado.txt',
      'novo.txt',
    ]);
  });

  it('nome com acento e espaço sai cru, não entre aspas com escapes em octal', () => {
    const raiz = criarRepositorio();
    const base = git(raiz, 'rev-parse', 'HEAD');
    escrever(raiz, { 'src/ação x.ts': '', 'src/ç.ts': '' });
    git(raiz, 'add', 'src');

    assert.deepEqual(arquivosAlterados(base, raiz), ['src/ação x.ts', 'src/ç.ts']);
  });

  it('renomeado aparece como apagado (nome antigo) mais novo (nome novo)', () => {
    const raiz = criarRepositorio({ 'antigo.txt': 'conteúdo\n' });
    const base = git(raiz, 'rev-parse', 'HEAD');
    renameSync(join(raiz, 'antigo.txt'), join(raiz, 'novo.txt'));
    git(raiz, 'add', '-A');

    assert.deepEqual(arquivosAlterados(base, raiz), ['antigo.txt', 'novo.txt']);
  });

  it('sem mudanças, lista vazia', () => {
    const raiz = criarRepositorio();

    assert.deepEqual(arquivosAlterados(git(raiz, 'rev-parse', 'HEAD'), raiz), []);
  });

  it('base inválida falha com o comando do git', () => {
    const raiz = criarRepositorio();

    assert.throws(() => arquivosAlterados('naoexiste', raiz), /git diff .* falhou/);
  });
});

describe('baseDaComparacao', () => {
  it('usa o merge-base de HEAD com main', () => {
    const raiz = criarRepositorio();
    const sha = git(raiz, 'rev-parse', 'HEAD');
    git(raiz, 'switch', '-q', '-c', 'feature');
    commit(raiz, 'f.txt', 'f');

    assert.deepEqual(baseDaComparacao(undefined, raiz), { ref: 'main', sha });
  });

  it('sem main, cai para origin/main', () => {
    const raiz = criarRepositorio();
    const sha = git(raiz, 'rev-parse', 'HEAD');
    git(raiz, 'update-ref', 'refs/remotes/origin/main', sha);
    git(raiz, 'switch', '-q', '-c', 'feature');
    git(raiz, 'branch', '-q', '-D', 'main');

    assert.deepEqual(baseDaComparacao(undefined, raiz), { ref: 'origin/main', sha });
  });

  it('sem main nem origin/main, falha pedindo --base', () => {
    const raiz = criarRepositorio();
    git(raiz, 'switch', '-q', '-c', 'feature');
    git(raiz, 'branch', '-q', '-D', 'main');

    assert.throws(
      () => baseDaComparacao(undefined, raiz),
      /não achei o merge-base de HEAD com main nem origin\/main; use --base <ref>/,
    );
  });

  it('--base vale no lugar de main, e uma ref inexistente falha', () => {
    const raiz = criarRepositorio();
    const sha = git(raiz, 'rev-parse', 'HEAD');
    git(raiz, 'switch', '-q', '-c', 'feature');
    commit(raiz, 'f.txt', 'f');

    assert.deepEqual(baseDaComparacao('main~0', raiz), { ref: 'main~0', sha });
    assert.throws(() => baseDaComparacao('fantasma', raiz), /merge-base de HEAD com fantasma/);
  });

  it('main e origin/main no mesmo ponto: sem aviso', () => {
    const raiz = criarRepositorio();
    git(raiz, 'update-ref', 'refs/remotes/origin/main', git(raiz, 'rev-parse', 'HEAD'));

    assert.equal(baseDaComparacao(undefined, raiz).aviso, undefined);
  });

  for (const [mais_antigo, mais_novo] of [
    ['origin/main', 'main'],
    ['main', 'origin/main'],
  ]) {
    it(`main e origin/main divergem: usa o mais antigo (${mais_antigo}) e avisa`, () => {
      const raiz = criarRepositorio();
      const antigo = git(raiz, 'rev-parse', 'HEAD');
      const novo = commit(raiz, 'b.txt', 'b');
      // HEAD fica no ponto mais novo, com um commit próprio por cima.
      git(raiz, 'switch', '-q', '-c', 'feature', novo);
      const refs = { [mais_antigo]: antigo, [mais_novo]: novo };
      git(raiz, 'update-ref', 'refs/remotes/origin/main', refs['origin/main']);
      git(raiz, 'update-ref', 'refs/heads/main', refs.main);
      commit(raiz, 'f.txt', 'f');

      const base = baseDaComparacao(undefined, raiz);

      assert.equal(base.ref, mais_antigo);
      assert.equal(base.sha, antigo);
      assert.match(base.aviso, /main .* e origin\/main .* divergem; usando o mais antigo/);
    });
  }
});

// ---------------------------------------------------------------- contratos no quick (tarefa 046)
describe('mudouContrato', () => {
  for (const arquivo of [
    'apps/api/openapi.yaml',
    'eventbus/socketio/asyncapi.yaml',
    'eventbus/x/y/z.json',
    'packages/contracts/src/gerado/openapi.ts',
    'packages/contracts/package.json',
    'redocly.yaml',
    '.redocly.lint-ignore.yaml',
    'scripts/contracts-gen.mjs',
    'scripts/contracts-lint.mjs',
  ]) {
    it(`${arquivo} liga contracts:lint e contracts:check`, () => {
      assert.equal(mudouContrato(['README.md', arquivo]), true);
    });
  }

  for (const arquivo of [
    'apps/api/src/app.ts',
    'apps/api/openapi.yaml.bak',
    'eventbus-x/a.yaml',
    'packages/contracts-extra/a.ts',
    'scripts/verify.mjs',
    'scripts/contracts.md',
    'docs/redocly.yaml',
    'sub/scripts/contracts-gen.mjs',
  ]) {
    it(`${arquivo} não liga os contratos`, () => {
      assert.equal(mudouContrato([arquivo]), false);
    });
  }

  it('sem alterações, não liga', () => {
    assert.equal(mudouContrato([]), false);
  });
});

// ---------------------------------------------------------------- fronteiras no quick (tarefa 048)
describe('gatilho do teste de fronteiras', () => {
  const FRONTEIRAS = 'test/boundaries/fronteiras.test.ts';
  const todosExistem = () => true;

  for (const gatilho of ['eslint.config.mjs', 'tsconfig.base.json']) {
    it(`${gatilho} alterado inclui o teste de fronteiras nos testes da API`, () => {
      const raiz = criarWorkspace();

      const mapa = testesRelacionados(raiz, lerPacotes(raiz), [gatilho], todosExistem);

      assert.deepEqual(mapa.get('apps/api'), [FRONTEIRAS]);
    });
  }

  it('sem eslint.config.mjs nem tsconfig.base.json alterados, não inclui', () => {
    const raiz = criarWorkspace();

    const mapa = testesRelacionados(
      raiz,
      lerPacotes(raiz),
      ['apps/api/src/a.ts', 'eslint.config.mjs.bak', 'apps/web/eslint.config.mjs'],
      todosExistem,
    );

    assert.ok(!(mapa.get('apps/api') ?? []).includes(FRONTEIRAS));
  });

  it('não inclui o teste se o arquivo não existe', () => {
    const raiz = criarWorkspace();

    const mapa = testesRelacionados(raiz, lerPacotes(raiz), ['eslint.config.mjs'], () => false);

    assert.equal(mapa.size, 0);
  });
});

describe('variaveisFaltandoParaOE2e', () => {
  const completo = {
    POSTGRES_API_USER: 'u-api',
    DB_API_PASSWORD: 'segredo-api',
    POSTGRES_USER: 'u',
    DB_PASSWORD: 'segredo-db',
    POSTGRES_DB: 'leilao',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: 'segredo-redis',
    SEED_DEMO_PASSWORD: 'demo',
  };

  it('ambiente completo não falta nada', () => {
    assert.deepEqual(variaveisFaltandoParaOE2e(completo), []);
  });

  it('lista ausentes e vazias, só os nomes, em ordem estável', () => {
    const faltando = variaveisFaltandoParaOE2e({
      ...completo,
      POSTGRES_API_USER: undefined,
      DB_API_PASSWORD: '',
    });

    assert.deepEqual(faltando, ['POSTGRES_API_USER', 'DB_API_PASSWORD']);
    assert.ok(!JSON.stringify(faltando).includes('segredo'));
  });

  for (const nome of [
    'POSTGRES_USER',
    'DB_PASSWORD',
    'POSTGRES_DB',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
    'SEED_DEMO_PASSWORD',
  ]) {
    it(`${nome} ausente é apontada`, () => {
      const env = { ...completo, [nome]: undefined };

      assert.deepEqual(variaveisFaltandoParaOE2e(env), [nome]);
    });
  }

  it('ambiente vazio aponta todas, sem valores', () => {
    assert.equal(variaveisFaltandoParaOE2e({}).length, Object.keys(completo).length);
  });
});
