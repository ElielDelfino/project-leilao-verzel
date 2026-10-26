// Testes do comando forçado da chave de deploy (task 131; specs/014 §CI/CD e §Verificação de
// vazamento, ADR 0033 item 5 e ADR 0034 item 3): infra/deploy/deploy-ssh e
// infra/deploy/verificar-vazamento.sh. Rodar: pnpm test:scripts.
// Nada aqui toca o Docker nem a rede: `docker`, `curl`, `swapon`, `journalctl` e `ps` são falsos
// no PATH e registram o argv; o estado e os segredos ficam num diretório temporário. O grep da
// verificação de vazamento é o real (o `docker exec` falso o executa no host com os arquivos de
// teste), então o método `grep -qF -f <arquivo>` é exercitado de verdade.
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ_DO_REPO = resolve(import.meta.dirname, '..');
const DEPLOY_SSH = join(RAIZ_DO_REPO, 'infra/deploy/deploy-ssh');
const REGISTRO = 'ghcr.io/teste';
const UID = process.getuid();
const NOMES_DOS_SEGREDOS = [
  'db_password',
  'db_api_password',
  'redis_password',
  'jwt_secret',
  'pseudonym_hmac_key',
  'ed25519_private_key',
];
const ARQUIVOS_DO_PACOTE = ['.env', 'infra/prod.env', 'infra/docker-compose.prod.yml'];
const shaAleatorio = () => randomBytes(20).toString('hex');
const imagemApi = (sha) => `${REGISTRO}/leilao-api:${sha}`;
const imagemWeb = (sha) => `${REGISTRO}/leilao-web:${sha}`;

const base = mkdtempSync(join(tmpdir(), 'leilao-deploy-ssh-'));
after(() => rmSync(base, { recursive: true, force: true }));
let contador = 0;
const novoDiretorio = (nome) => {
  const caminho = join(base, `${nome}-${(contador += 1)}`);
  mkdirSync(caminho, { recursive: true });
  return caminho;
};

// ---------------------------------------------------------------- comandos falsos

// docker falso: registra o argv (com API_IMAGE e WEB_IMAGE do ambiente) e simula o daemon.
//   FAKE_FALHAS=pull,migrate,compose-sem-imagem   etapas que falham
//   FAKE_UP_QUEBRADO=<imagem da api>              o `up` dessa imagem sai 1
//   FAKE_UP_QUEBRADO_COM=<texto>                  o `up` sai 1 se o arquivo do -f contém o texto
//   FAKE_VAZA_FONTE e FAKE_VAZA_SEGREDO           a fonte (inspect, config, history-api,
//                                                 history-web) imprime o valor do segredo
//   FAKE_UP_ESPERA=<arquivo>                      o `up` espera o arquivo existir (até 10 s)
// O `up` imprime progresso no stdout e no stderr, como o compose, e sai 1 se a escrita falhar
// (um CLI que morre com a saída fechada).
const DOCKER_FALSO = `#!/bin/bash
printf 'API_IMAGE=%s WEB_IMAGE=%s :: %s\\n' "$API_IMAGE" "$WEB_IMAGE" "$*" >>"$FAKE_DIR/docker.log"
falha() { case ",$FAKE_FALHAS," in *",$1,"*) return 0 ;; esac; return 1; }
vaza() { if [ "$FAKE_VAZA_FONTE" = "$1" ]; then cat "$FAKE_SEGREDOS/$FAKE_VAZA_SEGREDO"; echo; fi; return 0; }
fontes() { for a in "$@"; do case $a in type=bind,src=*) printf '%s\\n' "$a" | sed 's/^type=bind,src=//; s/,.*//' ;; esac; done; }
if [ "$1" = compose ]; then
  shift
  while [ $# -gt 0 ]; do
    case $1 in -f) arquivo=$2; shift 2 ;; -p|--env-file|--profile) shift 2 ;; *) break ;; esac
  done
  sub=$1; shift
  case $sub in
    config)
      if [ "$1" = --images ]; then
        if falha compose-sem-imagem; then printf 'leilao-api:local\\nleilao-web:local\\n'
        else printf '%s\\n' postgres:18.6-alpine redis:8.8.3-alpine "$API_IMAGE" "$WEB_IMAGE"; fi
      else echo 'name: leilao-prod'; vaza config; fi ;;
    pull) falha pull && exit 1; printf '%s\\n' "$API_IMAGE" "$WEB_IMAGE" >>"$FAKE_DIR/imagens" ;;
    run) falha migrate && exit 1 ;;
    up)
      if [ -n "$FAKE_UP_ESPERA" ]; then
        i=0; while [ ! -e "$FAKE_UP_ESPERA" ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
      fi
      printf ' Container leilao-prod-api-1  Started\\n' || exit 1
      printf ' Container leilao-prod-api-1  Started\\n' >&2 || exit 1
      printf '%s\\n' "$API_IMAGE" >"$FAKE_DIR/no-ar"
      [ "$FAKE_UP_QUEBRADO" = "$API_IMAGE" ] && exit 1
      if [ -n "$FAKE_UP_QUEBRADO_COM" ] && grep -qF -- "$FAKE_UP_QUEBRADO_COM" "$arquivo"; then exit 1; fi ;;
    ps) printf 'c0ffee01\\nc0ffee02\\n' ;;
    *) echo "compose $sub inesperado" >&2; exit 99 ;;
  esac
  exit 0
fi
case $1 in
  image)
    case $2 in
      inspect) shift 2; for i in "$@"; do grep -qxF -- "$i" "$FAKE_DIR/imagens" 2>/dev/null || exit 1; done ;;
      ls) for a in "$@"; do repo=$a; done; grep -F -- "$repo:" "$FAKE_DIR/imagens" 2>/dev/null | sort -u ;;
      rm) shift 2; for i in "$@"; do grep -vxF -- "$i" "$FAKE_DIR/imagens" >"$FAKE_DIR/imagens.novo"; mv "$FAKE_DIR/imagens.novo" "$FAKE_DIR/imagens"; done ;;
      *) exit 99 ;;
    esac ;;
  run)
    for src in $(fontes "$@"); do
      [ -e "$src" ] || { echo "bind source path does not exist: $src" >&2; exit 125; }
    done
    case " $* " in
      *" -d "*) echo id-do-auxiliar ;;
      *) for src in $(fontes "$@"); do [ -f "$src" ] && [ -s "$src" ] || exit 1; done ;;
    esac ;;
  exec) shift; [ "$1" = -i ] && shift; shift; exec "$@" ;;
  inspect) echo '[{"Id":"c0ffee01"}]'; vaza inspect ;;
  history)
    for img in "$@"; do :; done
    echo 'IMAGE CREATED BY'
    [ "$img" = "$API_IMAGE" ] && vaza history-api
    [ "$img" = "$WEB_IMAGE" ] && vaza history-web ;;
  rm) ;;
  *) echo "docker $1 inesperado" >&2; exit 99 ;;
esac
exit 0
`;

// curl falso: /api/health/ready responde 503 enquanto a imagem no ar for FAKE_READY_QUEBRADO.
const CURL_FALSO = `#!/bin/bash
for url in "$@"; do :; done
printf '%s\\n' "$url" >>"$FAKE_DIR/curl.log"
case $url in
  */api/health/ready)
    if [ -n "$FAKE_READY_QUEBRADO" ] && [ "$(cat "$FAKE_DIR/no-ar" 2>/dev/null)" = "$FAKE_READY_QUEBRADO" ]; then printf 503; else printf 200; fi ;;
  *) printf 200 ;;
esac
`;

const SWAPON_FALSO = `#!/bin/bash
[ -n "$FAKE_SEM_SWAP" ] || printf '/swapfile file 2G 0B -2\\n'
`;

const JOURNALCTL_FALSO = `#!/bin/bash
printf '%s\\n' "$*" >>"$FAKE_DIR/journalctl.log"
[ -n "$FAKE_JOURNAL_VAZIO" ] && exit 0
echo 'out 25 00:00:01 vps materializar-segredos.sh[1]: materializar-segredos: jwt_secret gravado'
if [ "$FAKE_VAZA_FONTE" = journal ]; then cat "$FAKE_SEGREDOS/$FAKE_VAZA_SEGREDO"; echo; fi
exit 0
`;

const PS_FALSO = `#!/bin/bash
echo 'bash /opt/leilao/bin/deploy-ssh'
if [ "$FAKE_VAZA_FONTE" = ps ]; then cat "$FAKE_SEGREDOS/$FAKE_VAZA_SEGREDO"; echo; fi
exit 0
`;

function cenario() {
  const raiz = novoDiretorio('cenario');
  const fake = join(raiz, 'fake');
  const bin = join(raiz, 'bin');
  const segredos = join(raiz, 'run', 'leilao', 'secrets');
  mkdirSync(fake);
  mkdirSync(bin);
  mkdirSync(segredos, { recursive: true, mode: 0o700 });
  for (const [nome, conteudo] of [
    ['docker', DOCKER_FALSO],
    ['curl', CURL_FALSO],
    ['swapon', SWAPON_FALSO],
    ['journalctl', JOURNALCTL_FALSO],
    ['ps', PS_FALSO],
  ]) {
    writeFileSync(join(bin, nome), conteudo, { mode: 0o755 });
  }
  const valores = {};
  for (const nome of NOMES_DOS_SEGREDOS) {
    valores[nome] = randomBytes(32).toString('base64url');
    writeFileSync(join(segredos, nome), valores[nome], { mode: 0o600 });
  }
  return { raiz, fake, bin, segredos, estado: join(raiz, 'leilao'), valores };
}

function pacote({ omitir = [], extras = {}, transformar, opcoesExtras = [] } = {}) {
  const dir = novoDiretorio('pacote');
  mkdirSync(join(dir, 'infra'));
  writeFileSync(join(dir, '.env'), 'TZ=UTC\n');
  writeFileSync(join(dir, 'infra/prod.env'), 'CADDY_SITE_ADDRESS=teste-verzel.duckdns.org\n');
  writeFileSync(join(dir, 'infra/docker-compose.prod.yml'), 'name: leilao-prod\n');
  for (const [nome, conteudo] of Object.entries(extras)) {
    if (typeof conteudo === 'function') conteudo(join(dir, nome));
    else writeFileSync(join(dir, nome), conteudo);
  }
  const arquivos = [
    ...ARQUIVOS_DO_PACOTE.filter((a) => !omitir.includes(a)),
    ...Object.keys(extras).filter((a) => !ARQUIVOS_DO_PACOTE.includes(a)),
  ];
  // Mesmo formato do deploy.yml.
  const opcoes = ['--owner=0', '--group=0', '--numeric-owner', ...opcoesExtras];
  if (transformar) opcoes.push(`--transform=${transformar}`);
  const tar = spawnSync('tar', ['-cf', '-', ...opcoes, '--', ...arquivos], { cwd: dir });
  assert.equal(tar.status, 0, tar.stderr?.toString());
  return tar.stdout;
}

function ambienteDe(c, pedido, env) {
  const ambiente = {
    PATH: `${c.bin}:${process.env.PATH}`,
    HOME: c.raiz,
    LC_ALL: 'C.UTF-8',
    LEILAO_DEPLOY_DIR: c.estado,
    LEILAO_SECRETS_DIR: c.segredos,
    LEILAO_SECRETS_UID: String(UID),
    LEILAO_REGISTRO: REGISTRO,
    LEILAO_HEALTH_TIMEOUT: '1',
    LEILAO_HEALTH_INTERVALO: '0.1',
    FAKE_DIR: c.fake,
    FAKE_SEGREDOS: c.segredos,
    ...env,
  };
  if (pedido !== undefined) ambiente.SSH_ORIGINAL_COMMAND = pedido;
  // Registros só desta execução; o estado do daemon falso (imagens, no-ar) continua.
  for (const registro of ['docker.log', 'curl.log', 'journalctl.log']) {
    rmSync(join(c.fake, registro), { force: true });
  }
  return ambiente;
}

const lerRegistro = (c, nome) =>
  existsSync(join(c.fake, nome)) ? readFileSync(join(c.fake, nome), 'utf8') : '';

function rodar(c, pedido, { entrada = '', env = {} } = {}) {
  const ambiente = ambienteDe(c, pedido, env);
  const saida = spawnSync(DEPLOY_SSH, [], { env: ambiente, input: entrada, encoding: 'utf8' });
  const ler = (nome) => lerRegistro(c, nome);
  const docker = ler('docker.log').split('\n').filter(Boolean);
  for (const valor of Object.values(c.valores)) {
    for (const [fonte, texto] of [
      ['stdout', saida.stdout],
      ['stderr', saida.stderr],
      ['argv do docker', docker.join('\n')],
      ['argv do curl', ler('curl.log')],
    ]) {
      assert.ok(!texto.includes(valor), `um valor de segredo apareceu em ${fonte}`);
    }
  }
  return { ...saida, docker, curl: ler('curl.log').split('\n').filter(Boolean) };
}

const deploy = (c, sha, opcoes = {}) => rodar(c, `deploy ${sha}`, { entrada: pacote(), ...opcoes });

// Queda do SSH: assim que o deploy-ssh anuncia o `up`, o stdout e o stderr são fechados do lado
// de cá (as próximas escritas dão EPIPE/SIGPIPE) e só então o `up` falso continua.
async function rodarComSaidaFechadaNoUp(c, pedido, { entrada, env = {} }) {
  const continuar = join(c.fake, 'continuar');
  rmSync(continuar, { force: true });
  const ambiente = ambienteDe(c, pedido, { ...env, FAKE_UP_ESPERA: continuar });
  const filho = spawn(DEPLOY_SSH, [], { env: ambiente, stdio: ['pipe', 'pipe', 'pipe'] });
  const fim = once(filho, 'exit');
  let lido = '';
  let fechada = false;
  filho.stdout.setEncoding('utf8');
  filho.stdout.on('data', (trecho) => {
    lido += trecho;
    if (fechada || !/up -d --no-build de /.test(lido)) return;
    fechada = true;
    filho.stdout.destroy();
    filho.stderr.destroy();
    writeFileSync(continuar, '');
  });
  filho.stdin.end(entrada);
  const [status, sinal] = await fim;
  for (const valor of Object.values(c.valores)) {
    assert.ok(!lido.includes(valor), 'um valor de segredo apareceu no stdout');
  }
  const docker = lerRegistro(c, 'docker.log').split('\n').filter(Boolean);
  return { status, sinal, fechada, docker };
}

const linkDe = (c, nome) => {
  const caminho = join(c.estado, nome);
  return existsSync(caminho) ? readlinkSync(caminho) : null;
};

// Chamadas `docker compose ... <sub>` com a imagem da API do ambiente.
const chamadas = (saida, trecho) => saida.docker.filter((linha) => linha.includes(trecho));
const ups = (saida) => chamadas(saida, ':: compose ').filter((l) => / up /.test(l));
const imagemDoUp = (linha) => linha.match(/^API_IMAGE=(\S*)/)[1];
const posicao = (saida, regex) => saida.docker.findIndex((linha) => regex.test(linha));

// ---------------------------------------------------------------- pedidos recusados

describe('deploy-ssh: pedidos recusados', () => {
  const sha = shaAleatorio();
  const recusados = [
    ['sessão sem comando', undefined],
    ['comando vazio', ''],
    ['id', 'id'],
    ['backup (fora da entrega, ADR 0034)', 'backup'],
    ['deploy sem sha', 'deploy'],
    ['sha curto', `deploy ${sha.slice(0, 39)}`],
    ['sha longo', `deploy ${sha}0`],
    ['sha em maiúsculas', `deploy ${sha.toUpperCase()}`],
    ['sha não hex', `deploy ${'g'.repeat(40)}`],
    ['argumento a mais', `deploy ${sha} --force`],
    ['espaço duplo', `deploy  ${sha}`],
    ['espaço no fim', `deploy ${sha} `],
    ['comando encadeado', `deploy ${sha}; id`],
    ['quebra de linha', `deploy ${sha}\nid`],
    ['rollback com argumento', 'rollback 1'],
    ['Rollback', 'Rollback'],
    ['shell', 'sh -c id'],
    ['sftp', 'internal-sftp'],
  ];
  for (const [nome, pedido] of recusados) {
    it(`${nome}: sai 1 sem executar nada`, () => {
      const c = cenario();
      const saida = rodar(c, pedido, { entrada: pacote() });
      assert.equal(saida.status, 1);
      assert.match(saida.stderr, /comando recusado/);
      assert.deepEqual(saida.docker, [], 'nenhuma chamada ao docker');
      assert.deepEqual(saida.curl, [], 'nenhuma chamada ao curl');
      assert.equal(existsSync(c.estado), false, 'o estado não é criado');
      assert.equal(existsSync(join(c.raiz, 'leilao')), false);
    });
  }

  it('argumento na linha de comando (fora do sshd): sai 1 sem executar nada', () => {
    const c = cenario();
    const saida = spawnSync(DEPLOY_SSH, ['rollback'], {
      env: {
        PATH: `${c.bin}:${process.env.PATH}`,
        FAKE_DIR: c.fake,
        SSH_ORIGINAL_COMMAND: 'rollback',
      },
      encoding: 'utf8',
    });
    assert.equal(saida.status, 1);
    assert.equal(existsSync(join(c.fake, 'docker.log')), false);
  });
});

// ---------------------------------------------------------------- deploy

describe('deploy-ssh: deploy <sha>', () => {
  it('primeiro deploy: pull, segredos, migrate e up --no-build, health, vazamento e registro', () => {
    const c = cenario();
    const sha = shaAleatorio();
    const saida = deploy(c, sha);
    assert.equal(saida.status, 0, saida.stderr);
    assert.match(saida.stdout, /verificar-vazamento: nenhum segredo nas saídas do Docker/);
    assert.match(saida.stdout, new RegExp(`deploy de ${sha} concluído`));
    assert.equal(linkDe(c, 'atual'), `releases/${sha}`);
    assert.equal(linkDe(c, 'anterior'), null);
    for (const arquivo of ARQUIVOS_DO_PACOTE) {
      assert.ok(existsSync(join(c.estado, 'releases', sha, arquivo)), arquivo);
    }

    const ordem = [
      / :: compose .* config --images$/,
      / :: compose .* pull --quiet$/,
      / :: image inspect /,
      / :: run --rm --network none .* --entrypoint test /,
      / :: compose .* --profile ops run --rm -T --pull never migrate$/,
      / :: compose .* up -d --no-build --pull never --remove-orphans$/,
      / :: compose .* ps -aq$/,
      / :: run -d --rm --name leilao-vazamento-/,
    ];
    const posicoes = ordem.map((regex) => posicao(saida, regex));
    for (const [i, p] of posicoes.entries()) assert.ok(p >= 0, `faltou ${ordem[i]}`);
    assert.deepEqual(
      [...posicoes].sort((a, b) => a - b),
      posicoes,
      'ordem dos passos',
    );

    // Toda chamada ao compose usa as imagens do sha, com os -p, --env-file e -f do pacote recebido
    // (diretório provisório até o deploy dar certo).
    for (const linha of chamadas(saida, ':: compose ')) {
      assert.ok(linha.startsWith(`API_IMAGE=${imagemApi(sha)} WEB_IMAGE=${imagemWeb(sha)} ::`));
    }
    const provisorio = `${c.estado}/releases/.novo.`;
    const migrate = chamadas(saida, ' migrate')[0];
    assert.match(
      migrate,
      new RegExp(
        `compose -p leilao-prod --env-file ${provisorio}(\\d+)/\\.env --env-file ${provisorio}\\1/infra/prod\\.env ` +
          `-f ${provisorio}\\1/infra/docker-compose\\.prod\\.yml --profile ops run`,
      ),
    );
    assert.deepEqual(
      readdirSync(join(c.estado, 'releases')),
      [sha],
      'sem provisório nem pacote depois do deploy',
    );
    // Health no host do infra/prod.env.
    assert.ok(saida.curl.includes('https://teste-verzel.duckdns.org/api/health/ready'));
    assert.ok(saida.curl.includes('https://teste-verzel.duckdns.org/'));
    // Os 6 segredos conferidos e montados no auxiliar só como arquivo, nunca por valor.
    const auxiliar = saida.docker.find((l) => / :: run -d /.test(l));
    for (const nome of NOMES_DOS_SEGREDOS) {
      assert.ok(auxiliar.includes(`type=bind,src=${c.segredos}/${nome},`), nome);
    }
    assert.match(auxiliar, /--network none --read-only --cap-drop ALL/);
  });

  it('nunca constrói imagem: sem `build`, todo up com --no-build e --pull never', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    assert.equal(deploy(c, sha1).status, 0);
    // Deploy com rollback: passa pelos dois `up` (o do sha novo e o da volta).
    const saida = deploy(c, sha2, { env: { FAKE_READY_QUEBRADO: imagemApi(sha2) } });
    assert.notEqual(saida.status, 0);
    assert.equal(ups(saida).length, 2);
    assert.equal(chamadas(saida, ' build').length, 0);
    assert.equal(chamadas(saida, '--build').length, 0);
    for (const linha of ups(saida)) assert.match(linha, / up -d --no-build --pull never /);
    const migrate = chamadas(saida, ' migrate');
    assert.equal(migrate.length, 1);
    assert.match(migrate[0], / run --rm -T --pull never migrate$/);
  });

  it('compose que ignora API_IMAGE/WEB_IMAGE: sai 1 antes do pull', () => {
    const c = cenario();
    const saida = deploy(c, shaAleatorio(), { env: { FAKE_FALHAS: 'compose-sem-imagem' } });
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /não usa API_IMAGE e WEB_IMAGE/);
    assert.equal(chamadas(saida, ' pull').length, 0);
    assert.equal(ups(saida).length, 0);
  });

  it('health falho leva ao rollback para as tags anteriores, com saída ≠ 0', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    assert.equal(deploy(c, sha1).status, 0);
    const saida = deploy(c, sha2, { env: { FAKE_READY_QUEBRADO: imagemApi(sha2) } });
    assert.notEqual(saida.status, 0);
    assert.match(saida.stdout, /health falhou: \/api\/health\/ready=503/);
    assert.match(saida.stdout, new RegExp(`versão ${sha1} de volta no ar`));
    assert.match(saida.stderr, new RegExp(`deploy de ${sha2} falhou`));
    assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha2), imagemApi(sha1)]);
    const volta = ups(saida)[1];
    assert.ok(volta.includes(`WEB_IMAGE=${imagemWeb(sha1)}`));
    assert.ok(
      volta.includes(`-f ${join(c.estado, 'releases', sha1)}/infra/docker-compose.prod.yml`),
    );
    assert.equal(linkDe(c, 'atual'), `releases/${sha1}`, 'a versão registrada continua a anterior');
    assert.equal(chamadas(saida, ' run -d ').length, 0, 'sem verificação de vazamento');
  });

  it('up falho também volta para a versão anterior', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    assert.equal(deploy(c, sha1).status, 0);
    const saida = deploy(c, sha2, { env: { FAKE_UP_QUEBRADO: imagemApi(sha2) } });
    assert.notEqual(saida.status, 0);
    assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha2), imagemApi(sha1)]);
    assert.equal(linkDe(c, 'atual'), `releases/${sha1}`);
  });

  const FONTES = [
    ['inspect', 'docker inspect'],
    ['config', 'docker compose config'],
    ['history-api', 'docker history (api)'],
    ['history-web', 'docker history (web)'],
    ['ps', 'ps -eww'],
    ['journal', 'journalctl -u leilao-segredos.service'],
  ];
  for (const [fonte, rotulo] of FONTES) {
    it(`vazamento em ${rotulo} leva ao rollback, citando só nome e fonte`, () => {
      const c = cenario();
      const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
      assert.equal(deploy(c, sha1).status, 0);
      const saida = deploy(c, sha2, {
        env: { FAKE_VAZA_FONTE: fonte, FAKE_VAZA_SEGREDO: 'jwt_secret' },
      });
      assert.notEqual(saida.status, 0);
      assert.ok(
        saida.stdout.includes(`verificar-vazamento: jwt_secret: ${rotulo}\n`),
        saida.stdout,
      );
      assert.equal((saida.stdout.match(/verificar-vazamento: \w+: /g) ?? []).length, 1);
      assert.doesNotMatch(saida.stdout, /nenhum segredo/);
      assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha2), imagemApi(sha1)]);
      assert.equal(linkDe(c, 'atual'), `releases/${sha1}`);
      // O auxiliar é removido no fim.
      assert.ok(saida.docker.some((l) => / :: rm -f leilao-vazamento-/.test(l)));
    });
  }

  it('journal da unidade ilegível ou vazio: a verificação falha fechada e volta', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    assert.equal(deploy(c, sha1).status, 0);
    const saida = deploy(c, sha2, { env: { FAKE_JOURNAL_VAZIO: '1' } });
    assert.notEqual(saida.status, 0);
    assert.match(saida.stderr, /journal de leilao-segredos.service está vazio ou ilegível/);
    assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha2), imagemApi(sha1)]);
  });

  it('primeiro deploy falho só sai ≠ 0, sem rollback', () => {
    const c = cenario();
    const sha = shaAleatorio();
    const saida = deploy(c, sha, { env: { FAKE_READY_QUEBRADO: imagemApi(sha) } });
    assert.notEqual(saida.status, 0);
    assert.match(saida.stdout, /primeiro deploy: não há versão anterior/);
    assert.equal(ups(saida).length, 1);
    assert.equal(linkDe(c, 'atual'), null);
  });

  const ANTES_DE_SUBIR = [
    ['pull falho', { FAKE_FALHAS: 'pull' }, /docker compose pull falhou/],
    ['migrations falhas', { FAKE_FALHAS: 'migrate' }, /migrations falharam/],
    ['sem swap', { FAKE_SEM_SWAP: '1' }, /sem swap ativa/],
  ];
  for (const [nome, env, mensagem] of ANTES_DE_SUBIR) {
    it(`${nome}: sai 1 sem up e sem tocar na versão no ar`, () => {
      const c = cenario();
      const sha1 = shaAleatorio();
      assert.equal(deploy(c, sha1).status, 0);
      const saida = deploy(c, shaAleatorio(), { env });
      assert.equal(saida.status, 1);
      assert.match(saida.stderr, mensagem);
      assert.equal(ups(saida).length, 0);
      assert.equal(linkDe(c, 'atual'), `releases/${sha1}`);
    });
  }

  it('sem swap, o deploy para antes das migrations', () => {
    const c = cenario();
    const saida = deploy(c, shaAleatorio(), { env: { FAKE_SEM_SWAP: '1' } });
    assert.equal(saida.status, 1);
    assert.equal(chamadas(saida, ' migrate').length, 0);
  });

  for (const [nome, preparar] of [
    ['ausente', (arquivo) => rmSync(arquivo)],
    ['vazio', (arquivo) => writeFileSync(arquivo, '')],
  ]) {
    it(`arquivo de segredo ${nome}: sai 1 antes das migrations`, () => {
      const c = cenario();
      preparar(join(c.segredos, 'ed25519_private_key'));
      const saida = deploy(c, shaAleatorio());
      assert.equal(saida.status, 1);
      assert.match(saida.stderr, /faltam os 6 arquivos de segredo/);
      assert.equal(chamadas(saida, ' migrate').length, 0);
      assert.equal(ups(saida).length, 0);
    });
  }

  it('remove imagens e releases antigas, mantendo a atual e a anterior', () => {
    const c = cenario();
    const [sha1, sha2, sha3] = [shaAleatorio(), shaAleatorio(), shaAleatorio()];
    for (const sha of [sha1, sha2]) assert.equal(deploy(c, sha).status, 0);
    const saida = deploy(c, sha3);
    assert.equal(saida.status, 0, saida.stderr);
    assert.deepEqual(
      chamadas(saida, ':: image rm ').map((l) => l.split(':: image rm ')[1]),
      [imagemApi(sha1), imagemWeb(sha1)],
    );
    assert.equal(existsSync(join(c.estado, 'releases', sha1)), false);
    assert.ok(existsSync(join(c.estado, 'releases', sha2)));
    assert.equal(linkDe(c, 'atual'), `releases/${sha3}`);
    assert.equal(linkDe(c, 'anterior'), `releases/${sha2}`);
  });

  it('o mesmo sha com pacote quebrado volta para os arquivos que estavam no ar', () => {
    const c = cenario();
    const sha = shaAleatorio();
    assert.equal(deploy(c, sha).status, 0);
    const original = readFileSync(join(c.estado, 'releases', sha, 'infra/docker-compose.prod.yml'));
    const quebrado = pacote({
      extras: { 'infra/docker-compose.prod.yml': 'name: leilao-prod\n# quebrado\n' },
    });
    const saida = rodar(c, `deploy ${sha}`, {
      entrada: quebrado,
      env: { FAKE_UP_QUEBRADO_COM: '# quebrado' },
    });
    assert.notEqual(saida.status, 0);
    assert.equal(ups(saida).length, 2);
    assert.ok(ups(saida)[1].includes(`-f ${join(c.estado, 'releases', sha)}/infra/`));
    assert.match(saida.stdout, new RegExp(`versão ${sha} de volta no ar`));
    assert.deepEqual(
      readFileSync(join(c.estado, 'releases', sha, 'infra/docker-compose.prod.yml')),
      original,
      'a release no ar não foi sobrescrita',
    );
    assert.equal(linkDe(c, 'atual'), `releases/${sha}`);
    assert.deepEqual(readdirSync(join(c.estado, 'releases')), [sha], 'provisório removido');
  });

  it('remove resíduos .novo.* e .pacote.* de execuções mortas', () => {
    const c = cenario();
    const releases = join(c.estado, 'releases');
    mkdirSync(join(releases, '.novo.4242', 'infra'), { recursive: true });
    writeFileSync(join(releases, '.novo.4242', 'infra', 'prod.env'), 'x\n');
    writeFileSync(join(releases, '.pacote.4242.tar'), 'x');
    const sha = shaAleatorio();
    const saida = deploy(c, sha);
    assert.equal(saida.status, 0, saida.stderr);
    assert.deepEqual(readdirSync(releases), [sha]);
  });

  it('o mesmo sha de novo mantém a anterior registrada', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    for (const sha of [sha1, sha2, sha2]) assert.equal(deploy(c, sha).status, 0);
    assert.equal(linkDe(c, 'atual'), `releases/${sha2}`);
    assert.equal(linkDe(c, 'anterior'), `releases/${sha1}`);
  });
});

// ---------------------------------------------------------------- pacote do stdin

describe('deploy-ssh: pacote do stdin', () => {
  const invalidos = [
    ['stdin vazio', () => '', /stdin vazio/],
    ['não é tar', () => 'isto não é um tar\n', /não é um tar válido/],
    ['arquivo faltando', () => pacote({ omitir: ['infra/prod.env'] }), /exatamente/],
    ['arquivo a mais', () => pacote({ extras: { 'outro.yml': 'x: 1\n' } }), /exatamente/],
    ['caminho com ..', () => pacote({ transformar: 's,^\\.env$,../.env,' }), /exatamente/],
    ['caminho absoluto', () => pacote({ transformar: 's,^\\.env$,/tmp/.env,' }), /exatamente/],
    [
      'link simbólico no lugar de um arquivo',
      () =>
        pacote({
          extras: {
            'infra/prod.env': (caminho) => {
              rmSync(caminho);
              symlinkSync('/etc/passwd', caminho);
            },
          },
        }),
      /só pode ter arquivos comuns/,
    ],
    [
      'maior que 1 MiB',
      () => pacote({ extras: { '.env': `TZ=UTC\n# ${'x'.repeat(1024 * 1024)}\n` } }),
      /maior que/,
    ],
    // Lido de um arquivo, o GNU tar detectaria a compressão sozinho (um .tgz pequeno vira
    // centenas de MB); pelo stdin ele recusa.
    [
      'tar comprimido (gzip) com os 3 nomes',
      () => pacote({ opcoesExtras: ['--gzip'] }),
      /não é um tar válido/,
    ],
    // Membro esparso: poucos KB no pacote, 300 MiB ao extrair.
    [
      'membro esparso de 300 MiB',
      () =>
        pacote({
          opcoesExtras: ['--sparse'],
          extras: {
            'infra/prod.env': (caminho) => {
              writeFileSync(caminho, 'CADDY_SITE_ADDRESS=teste-verzel.duckdns.org\n');
              truncateSync(caminho, 300 * 1024 * 1024);
            },
          },
        }),
      /infra\/prod\.env maior que 1048576 bytes/,
    ],
  ];
  for (const [nome, gerar, mensagem] of invalidos) {
    it(`${nome}: sai 1 sem chamar o docker`, () => {
      const c = cenario();
      const saida = rodar(c, `deploy ${shaAleatorio()}`, { entrada: gerar() });
      assert.equal(saida.status, 1);
      assert.match(saida.stderr, mensagem);
      assert.deepEqual(saida.docker, []);
      assert.equal(existsSync(join(c.raiz, 'passwd')), false);
    });
  }

  it('stdin que não termina: desiste no prazo, sai 1 sem chamar o docker e solta a trava', async () => {
    const c = cenario();
    const ambiente = ambienteDe(c, `deploy ${shaAleatorio()}`, { LEILAO_PACOTE_TIMEOUT: '1' });
    const filho = spawn(DEPLOY_SSH, [], { env: ambiente, stdio: ['pipe', 'pipe', 'pipe'] });
    let erro = '';
    filho.stderr.setEncoding('utf8');
    filho.stderr.on('data', (trecho) => (erro += trecho));
    filho.stdout.resume();
    filho.stdin.write(pacote().subarray(0, 512));
    const [status] = await once(filho, 'exit');
    filho.stdin.destroy();
    assert.equal(status, 1);
    await once(filho, 'close');
    assert.match(erro, /o pacote não chegou em 1 s/);
    assert.equal(lerRegistro(c, 'docker.log'), '');
    assert.equal(deploy(c, shaAleatorio()).status, 0, 'a trava foi liberada');
  });

  it('CADDY_SITE_ADDRESS inválido: sai 1 sem chamar o docker', () => {
    const c = cenario();
    const entrada = pacote({
      extras: { 'infra/prod.env': 'CADDY_SITE_ADDRESS=x.org/../../evil?\n' },
    });
    const saida = rodar(c, `deploy ${shaAleatorio()}`, { entrada });
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /CADDY_SITE_ADDRESS ausente ou inválido/);
    assert.deepEqual(saida.docker, []);
  });
});

// ---------------------------------------------------------------- queda do SSH

describe('deploy-ssh: queda do SSH depois do up', () => {
  it('health falho: o fluxo termina, volta para a versão anterior e sai 1', async () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    assert.equal(deploy(c, sha1).status, 0);
    const saida = await rodarComSaidaFechadaNoUp(c, `deploy ${sha2}`, {
      entrada: pacote(),
      env: { FAKE_READY_QUEBRADO: imagemApi(sha2) },
    });
    assert.ok(saida.fechada, 'a saída foi fechada no up');
    assert.equal(saida.sinal, null, 'não morreu por sinal');
    assert.equal(saida.status, 1);
    assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha2), imagemApi(sha1)]);
    assert.equal(linkDe(c, 'atual'), `releases/${sha1}`);
    assert.deepEqual(readdirSync(join(c.estado, 'releases')), [sha1], 'provisório removido');
  });

  it('health bom: o deploy conclui, registra a versão e sai 0', async () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    assert.equal(deploy(c, sha1).status, 0);
    const saida = await rodarComSaidaFechadaNoUp(c, `deploy ${sha2}`, { entrada: pacote() });
    assert.ok(saida.fechada, 'a saída foi fechada no up');
    assert.equal(saida.sinal, null, 'não morreu por sinal');
    assert.equal(saida.status, 0);
    assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha2)]);
    assert.ok(saida.docker.some((l) => / :: run -d --rm --name leilao-vazamento-/.test(l)));
    assert.equal(linkDe(c, 'atual'), `releases/${sha2}`);
    assert.equal(linkDe(c, 'anterior'), `releases/${sha1}`);
  });
});

// ---------------------------------------------------------------- rollback

describe('deploy-ssh: rollback', () => {
  it('volta para a anterior com as imagens e o compose dela, trocando atual e anterior', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    for (const sha of [sha1, sha2]) assert.equal(deploy(c, sha).status, 0);
    const saida = rodar(c, 'rollback');
    assert.equal(saida.status, 0, saida.stderr);
    assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha1)]);
    assert.ok(ups(saida)[0].includes(`WEB_IMAGE=${imagemWeb(sha1)}`));
    assert.equal(chamadas(saida, ' pull').length, 0);
    assert.equal(chamadas(saida, ' migrate').length, 0);
    assert.equal(linkDe(c, 'atual'), `releases/${sha1}`);
    assert.equal(linkDe(c, 'anterior'), `releases/${sha2}`);
  });

  it('sem versão anterior: sai 1 sem up', () => {
    const c = cenario();
    assert.equal(deploy(c, shaAleatorio()).status, 0);
    const saida = rodar(c, 'rollback');
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /não há versão anterior/);
    assert.deepEqual(saida.docker, []);
  });

  it('anterior sem health: volta para a atual e sai 1', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    for (const sha of [sha1, sha2]) assert.equal(deploy(c, sha).status, 0);
    const saida = rodar(c, 'rollback', { env: { FAKE_READY_QUEBRADO: imagemApi(sha1) } });
    assert.equal(saida.status, 1);
    assert.deepEqual(ups(saida).map(imagemDoUp), [imagemApi(sha1), imagemApi(sha2)]);
    assert.equal(linkDe(c, 'atual'), `releases/${sha2}`);
  });

  it('outro deploy em andamento: sai 1 sem chamar o docker', () => {
    const c = cenario();
    const [sha1, sha2] = [shaAleatorio(), shaAleatorio()];
    for (const sha of [sha1, sha2]) assert.equal(deploy(c, sha).status, 0);
    const trava = join(c.estado, '.trava');
    // flock segura a trava enquanto o deploy-ssh roda dentro dele.
    const ambiente = {
      PATH: `${c.bin}:${process.env.PATH}`,
      LEILAO_DEPLOY_DIR: c.estado,
      FAKE_DIR: c.fake,
      SSH_ORIGINAL_COMMAND: 'rollback',
    };
    const saida = spawnSync('flock', [trava, DEPLOY_SSH], { env: ambiente, encoding: 'utf8' });
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /outro deploy ou rollback em andamento/);
  });
});
