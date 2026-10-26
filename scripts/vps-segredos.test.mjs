// Testes dos scripts da VPS (task 130, specs/014 §Servidor e §Segredos > Produção, ADR 0033):
// infra/deploy/gerar-env-local.sh, infra/deploy/materializar-segredos.sh e infra/vps/preparar-vps.sh.
// Rodar: pnpm test:scripts. Nada aqui toca o sistema: os caminhos vêm de LEILAO_ENV_LOCAL,
// LEILAO_SECRETS_DIR e LEILAO_VPS_RAIZ (sandbox), e os comandos do sistema são falsos no PATH.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// O mesmo validador da API (specs/014 §Leitura), importado do código real.
import { ehSegredoCanonico } from '../apps/api/src/config/segredos.ts';

const RAIZ_DO_REPO = resolve(import.meta.dirname, '..');
const GERADOR = join(RAIZ_DO_REPO, 'infra/deploy/gerar-env-local.sh');
const MATERIALIZADOR = join(RAIZ_DO_REPO, 'infra/deploy/materializar-segredos.sh');
const PREPARADOR = join(RAIZ_DO_REPO, 'infra/vps/preparar-vps.sh');

const VARIAVEIS = [
  'DB_PASSWORD',
  'DB_API_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_SECRET',
  'PSEUDONYM_HMAC_KEY',
  'ED25519_PRIVATE_KEY',
];
const UID = process.getuid();
const GID = process.getgid();

const base = mkdtempSync(join(tmpdir(), 'leilao-vps-'));
after(() => rmSync(base, { recursive: true, force: true }));
let contador = 0;
const novoDiretorio = (nome) => {
  const caminho = join(base, `${nome}-${(contador += 1)}`);
  mkdirSync(caminho, { recursive: true });
  return caminho;
};

const modo = (caminho) => statSync(caminho).mode & 0o777;
const aleatorio = () => randomBytes(32).toString('base64url');

// ---------------------------------------------------------------- argv observado

// Comandos externos que os dois scripts de segredo chamam: cada um vira um wrapper que registra o
// argv e chama o real. Um valor no argv apareceria nesse registro.
const COMANDOS_OBSERVADOS = ['head', 'base64', 'tr', 'mktemp', 'chmod', 'ln', 'rm', 'dirname'];
const COMANDOS_OBSERVADOS_MATERIALIZADOR = ['stat', 'mkdir', 'chmod', 'chown', 'mv', 'rm'];

function caminhoReal(comando) {
  const saida = spawnSync('sh', ['-c', `command -v ${comando}`], { encoding: 'utf8' });
  assert.equal(saida.status, 0, `${comando} não encontrado`);
  return saida.stdout.trim();
}

function binarioObservado(comandos) {
  const bin = novoDiretorio('bin-argv');
  for (const comando of new Set(comandos)) {
    const real = caminhoReal(comando);
    writeFileSync(
      join(bin, comando),
      `#!/bin/sh\nprintf '%s\\n' "${comando} $*" >>"$ARGV_LOG"\nexec ${real} "$@"\n`,
      { mode: 0o755 },
    );
  }
  return bin;
}

function rodar(script, { env = {}, args = [], bin } = {}) {
  const log = join(novoDiretorio('argv'), 'argv.log');
  writeFileSync(log, '');
  const PATH = bin ? `${bin}:${process.env.PATH}` : process.env.PATH;
  const saida = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH, HOME: process.env.HOME, LC_ALL: 'C.UTF-8', ARGV_LOG: log, ...env },
  });
  return { ...saida, argv: readFileSync(log, 'utf8') };
}

function semValores(saida, valores) {
  for (const valor of valores) {
    for (const [fonte, texto] of [
      ['stdout', saida.stdout],
      ['stderr', saida.stderr],
      ['argv', saida.argv],
    ]) {
      assert.ok(!texto.includes(valor), `um valor apareceu em ${fonte}`);
    }
  }
}

function lerEnv(caminho) {
  return Object.fromEntries(
    readFileSync(caminho, 'utf8')
      .split('\n')
      .filter((linha) => linha && !linha.startsWith('#'))
      .map((linha) => [linha.slice(0, linha.indexOf('=')), linha.slice(linha.indexOf('=') + 1)]),
  );
}

// ---------------------------------------------------------------- gerar-env-local.sh

describe('gerar-env-local.sh', () => {
  const gerar = (destino, bin) => rodar(GERADOR, { env: { LEILAO_ENV_LOCAL: destino }, bin });

  it('cria o .env.local 600 com os 6 valores na forma canônica, sem valor na saída nem no argv', () => {
    const destino = join(novoDiretorio('gerar'), '.env.local');
    const saida = gerar(destino, binarioObservado(COMANDOS_OBSERVADOS));
    assert.equal(saida.status, 0, saida.stderr);
    assert.equal(modo(destino), 0o600);
    const valores = lerEnv(destino);
    assert.deepEqual(Object.keys(valores), VARIAVEIS);
    for (const nome of VARIAVEIS) assert.ok(ehSegredoCanonico(valores[nome]), nome);
    assert.equal(new Set(Object.values(valores)).size, 6, 'os 6 valores são distintos');
    assert.ok(readFileSync(destino, 'utf8').endsWith('\n'));
    assert.ok(saida.argv.includes('head -c 32 /dev/urandom'), 'o wrapper registrou o argv');
    semValores(saida, Object.values(valores));
    for (const nome of VARIAVEIS) assert.match(saida.stdout, new RegExp(`- ${nome}\\n`));
    assert.deepEqual(readdirSync(join(destino, '..')), ['.env.local'], 'sem temporário');
  });

  it('a segunda execução sai 1 sem alterar nada', () => {
    const destino = join(novoDiretorio('gerar'), '.env.local');
    assert.equal(gerar(destino).status, 0);
    const antes = { conteudo: readFileSync(destino, 'utf8'), info: statSync(destino) };
    const saida = gerar(destino);
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /já existe; nada foi alterado/);
    const depois = statSync(destino);
    assert.equal(readFileSync(destino, 'utf8'), antes.conteudo);
    assert.equal(depois.mtimeMs, antes.info.mtimeMs);
    assert.equal(depois.ino, antes.info.ino);
    assert.equal(modo(destino), 0o600);
    semValores(saida, Object.values(lerEnv(destino)));
    assert.deepEqual(readdirSync(join(destino, '..')), ['.env.local']);
  });

  it('recusa um link simbólico no destino, mesmo pendente, sem segui-lo', () => {
    const dir = novoDiretorio('gerar');
    const destino = join(dir, '.env.local');
    symlinkSync(join(dir, 'alvo-inexistente'), destino);
    const saida = gerar(destino);
    assert.equal(saida.status, 1);
    assert.equal(readlinkSync(destino), join(dir, 'alvo-inexistente'));
    assert.equal(existsSync(join(dir, 'alvo-inexistente')), false);
  });

  it('sai 1 se o diretório não existe e 2 com argumento', () => {
    const destino = join(base, 'nao-existe', '.env.local');
    assert.equal(gerar(destino).status, 1);
    assert.equal(existsSync(destino), false);
    const comArgumento = rodar(GERADOR, {
      env: { LEILAO_ENV_LOCAL: join(novoDiretorio('gerar'), '.env.local') },
      args: ['--force'],
    });
    assert.equal(comArgumento.status, 2);
  });
});

// ---------------------------------------------------------------- materializar-segredos.sh

describe('materializar-segredos.sh', () => {
  const valoresValidos = () => Object.fromEntries(VARIAVEIS.map((nome) => [nome, aleatorio()]));
  const conteudoDoEnv = (valores) =>
    `# comentário\n${Object.entries(valores)
      .map(([nome, valor]) => `${nome}=${valor}`)
      .join('\n')}\n`;

  function cenario(conteudo, permissao = 0o600) {
    const dir = novoDiretorio('materializar');
    const envLocal = join(dir, '.env.local');
    writeFileSync(envLocal, conteudo, { mode: permissao });
    chmodSync(envLocal, permissao);
    const segredos = join(dir, 'run', 'leilao', 'secrets');
    const env = {
      LEILAO_ENV_LOCAL: envLocal,
      LEILAO_SECRETS_DIR: segredos,
      LEILAO_SECRETS_UID: String(UID),
    };
    return { envLocal, segredos, env };
  }

  const materializar = (env, bin) => rodar(MATERIALIZADOR, { env, bin });

  it('grava os 6 arquivos 600 sem quebra de linha, num diretório 700, imprimindo só nomes', () => {
    const valores = valoresValidos();
    const { segredos, env } = cenario(conteudoDoEnv(valores));
    const saida = materializar(env, binarioObservado(COMANDOS_OBSERVADOS_MATERIALIZADOR));
    assert.equal(saida.status, 0, saida.stderr);
    assert.equal(modo(segredos), 0o700);
    assert.deepEqual(
      readdirSync(segredos).sort(),
      VARIAVEIS.map((nome) => nome.toLowerCase()).sort(),
      'sem temporário',
    );
    for (const nome of VARIAVEIS) {
      const arquivo = join(segredos, nome.toLowerCase());
      assert.equal(readFileSync(arquivo, 'utf8'), valores[nome], nome);
      assert.ok(!readFileSync(arquivo, 'utf8').includes('\n'));
      assert.equal(modo(arquivo), 0o600, nome);
      assert.equal(statSync(arquivo).uid, UID);
      assert.ok(ehSegredoCanonico(readFileSync(arquivo, 'utf8')));
      assert.match(saida.stdout, new RegExp(`${nome.toLowerCase()} gravado`));
    }
    assert.ok(saida.argv.includes('chown --'), 'o wrapper registrou o argv');
    semValores(saida, Object.values(valores));
  });

  it('aceita a saída do gerador e reflete uma rotação na execução seguinte', () => {
    const dir = novoDiretorio('materializar');
    const envLocal = join(dir, '.env.local');
    assert.equal(rodar(GERADOR, { env: { LEILAO_ENV_LOCAL: envLocal } }).status, 0);
    const segredos = join(dir, 'secrets');
    const env = {
      LEILAO_ENV_LOCAL: envLocal,
      LEILAO_SECRETS_DIR: segredos,
      LEILAO_SECRETS_UID: String(UID),
    };
    assert.equal(materializar(env).status, 0);
    const valores = lerEnv(envLocal);
    const rotacionado = { ...valores, JWT_SECRET: aleatorio() };
    writeFileSync(envLocal, conteudoDoEnv(rotacionado));
    const saida = materializar(env);
    assert.equal(saida.status, 0, saida.stderr);
    assert.equal(readFileSync(join(segredos, 'jwt_secret'), 'utf8'), rotacionado.JWT_SECRET);
    assert.equal(readFileSync(join(segredos, 'db_password'), 'utf8'), valores.DB_PASSWORD);
    semValores(saida, [...Object.values(valores), rotacionado.JWT_SECRET]);
  });

  for (const ausente of VARIAVEIS) {
    it(`sai 1 citando só o nome quando falta ${ausente}, sem gravar nada`, () => {
      const valores = valoresValidos();
      const resto = Object.fromEntries(Object.entries(valores).filter(([n]) => n !== ausente));
      const { segredos, env } = cenario(conteudoDoEnv(resto));
      const saida = materializar(env);
      assert.equal(saida.status, 1);
      assert.match(saida.stderr, new RegExp(`${ausente} ausente`));
      assert.equal(existsSync(segredos), false);
      semValores(saida, Object.values(resto));
    });
  }

  const naoCanonicos = {
    'curto (42 caracteres)': () => aleatorio().slice(0, 42),
    'longo (44 caracteres)': () => `${aleatorio()}A`,
    'último caractere com bits extras': () => `${'A'.repeat(42)}B`,
    'com padding': () => `${aleatorio().slice(0, 42)}=`,
    'alfabeto base64 padrão': () => `${aleatorio().slice(0, 41)}+A`,
    'entre aspas': () => `"${aleatorio()}"`,
    'com espaço no fim': () => `${aleatorio()} `,
    vazio: () => '',
  };
  for (const [caso, fabricar] of Object.entries(naoCanonicos)) {
    it(`sai 1 citando só o nome com valor não canônico: ${caso}`, () => {
      const valores = valoresValidos();
      const ruim = fabricar();
      if (ruim) assert.equal(ehSegredoCanonico(ruim), false, 'o validador da API também recusa');
      const { segredos, env } = cenario(conteudoDoEnv({ ...valores, REDIS_PASSWORD: ruim }));
      const saida = materializar(env);
      assert.equal(saida.status, 1);
      assert.match(saida.stderr, /REDIS_PASSWORD fora da forma canônica/);
      assert.equal(existsSync(segredos), false);
      semValores(
        saida,
        [...Object.values(valores), ruim].filter((v) => v.length > 2),
      );
    });
  }

  it('sai 1 com quebra de linha: fim de linha CRLF', () => {
    const valores = valoresValidos();
    const { segredos, env } = cenario(conteudoDoEnv(valores).replaceAll('\n', '\r\n'));
    const saida = materializar(env);
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /DB_PASSWORD fora da forma canônica/);
    assert.equal(existsSync(segredos), false);
    semValores(saida, Object.values(valores));
  });

  it('sai 1 com quebra de linha: valor partido em duas linhas', () => {
    const valores = valoresValidos();
    const partido = `${valores.JWT_SECRET.slice(0, 20)}\n${valores.JWT_SECRET.slice(20)}`;
    const { segredos, env } = cenario(conteudoDoEnv({ ...valores, JWT_SECRET: partido }));
    const saida = materializar(env);
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /JWT_SECRET fora da forma canônica/);
    assert.equal(existsSync(segredos), false);
    semValores(saida, Object.values(valores));
  });

  it('a regra do último caractere é a mesma do validador da API para os 64 símbolos', () => {
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const prefixo = aleatorio().slice(0, 42);
    const conteudo = (ultimo) =>
      conteudoDoEnv({ ...valoresValidos(), PSEUDONYM_HMAC_KEY: `${prefixo}${ultimo}` });
    for (const ultimo of alfabeto) {
      const { env } = cenario(conteudo(ultimo));
      const aceito = materializar(env).status === 0;
      assert.equal(aceito, ehSegredoCanonico(`${prefixo}${ultimo}`), `último caractere ${ultimo}`);
    }
  });

  it('sai 1 com variável repetida, com .env.local fora de 600 e com destino que não é diretório', () => {
    const valores = valoresValidos();
    const repetida = cenario(`${conteudoDoEnv(valores)}JWT_SECRET=${aleatorio()}\n`);
    const saidaRepetida = materializar(repetida.env);
    assert.equal(saidaRepetida.status, 1);
    assert.match(saidaRepetida.stderr, /JWT_SECRET aparece mais de uma vez/);

    const aberto = cenario(conteudoDoEnv(valores), 0o644);
    const saidaAberta = materializar(aberto.env);
    assert.equal(saidaAberta.status, 1);
    assert.match(saidaAberta.stderr, /permissão 644; precisa ser 600/);
    assert.equal(existsSync(aberto.segredos), false);

    const arquivo = cenario(conteudoDoEnv(valores));
    mkdirSync(join(arquivo.segredos, '..'), { recursive: true });
    writeFileSync(arquivo.segredos, 'não é diretório');
    assert.equal(materializar(arquivo.env).status, 1);
    assert.equal(readFileSync(arquivo.segredos, 'utf8'), 'não é diretório');
  });

  it('fecha em 700 um diretório de segredos que já existia aberto', () => {
    const { segredos, env } = cenario(conteudoDoEnv(valoresValidos()));
    mkdirSync(segredos, { recursive: true, mode: 0o755 });
    chmodSync(segredos, 0o755);
    assert.equal(materializar(env).status, 0);
    assert.equal(modo(segredos), 0o700);
  });
});

// ---------------------------------------------------------------- preparar-vps.sh

// Comandos do sistema falsos. Os que alteram o sistema registram a chamada em FAKE_LOG e mudam o
// estado do sandbox; os de consulta leem esse estado.
const FALSOS = {
  getent: `case "$1" in passwd) f=etc/passwd ;; group) f=etc/group ;; *) exit 1 ;; esac
grep "^$2:" "$R/$f" || exit 2`,
  'dpkg-query': `for p; do :; done
grep -qx "$p" "$R/fake/dpkg" || exit 1
printf 'install ok installed'`,
  dpkg: `[ "$1" = --print-architecture ] && echo amd64`,
  'apt-get': `log "apt-get $*"
[ "$1" = install ] || exit 0
for p; do case "$p" in -*|install|*=*) ;; *) echo "$p" >>"$R/fake/dpkg" ;; esac; done
case " $* " in *" docker-ce "*) echo 'docker:x:999:' >>"$R/etc/group" ;; esac`,
  env: `while [ "\${1#*=}" != "$1" ]; do export "$1"; shift; done
exec "$@"`,
  curl: `log "curl $*"
while [ $# -gt 0 ]; do [ "$1" = -o ] && echo CHAVE-FALSA >"$2"; shift; done`,
  useradd: `log "useradd $*"
for u; do :; done
echo "$u:x:1001:1001::/home/$u:/bin/bash" >>"$R/etc/passwd"
echo "$u:x:1001:" >>"$R/etc/group"`,
  usermod: `log "usermod $*"
awk -F: -v g="$2" -v u="$3" 'BEGIN { OFS = ":" } $1 == g { $4 = ($4 == "" ? u : $4 "," u) } { print }' \\
  "$R/etc/group" >"$R/fake/tmp" && cat "$R/fake/tmp" >"$R/etc/group" && rm "$R/fake/tmp"`,
  gpasswd: `log "gpasswd $*"
awk -F: -v g="$3" -v u="$2" 'BEGIN { OFS = ":" } $1 == g { n = split($4, m, ","); $4 = ""
  for (i = 1; i <= n; i++) if (m[i] != u) $4 = ($4 == "" ? m[i] : $4 "," m[i]) } { print }' \\
  "$R/etc/group" >"$R/fake/tmp" && cat "$R/fake/tmp" >"$R/etc/group" && rm "$R/fake/tmp"`,
  systemctl: `case "$1" in is-enabled|is-active) echo enabled; exit 0 ;; esac
log "systemctl $*"`,
  sshd: `[ "$1" = -t ] || exit 1
[ -z "$FAKE_SSHD_FALHA" ] || { echo 'linha 9: opção inválida' >&2; exit 255; }`,
  fallocate: `log "fallocate $*"
log "fallocate umask $(umask)"
for f; do :; done
: >"$f"`,
  mkswap: `log "mkswap $*"`,
  swapon: `log "swapon $*"
printf '/swapfile\\tfile\\t2097148\\t0\\t-2\\n' >>"$R/proc/swaps"`,
  ufw: `d="$R/fake/ufw"
case "$*" in
  "status verbose")
    echo "Status: $(cat "$d/status")"
    [ "$(cat "$d/status")" = active ] &&
      echo "Default: $(cat "$d/incoming") (incoming), $(cat "$d/outgoing") (outgoing), disabled (routed)"
    exit 0 ;;
  "show added")
    echo "Added user rules (see 'ufw status' for running firewall):"
    if [ -s "$d/rules" ]; then cat "$d/rules"; else echo '(None)'; fi
    exit 0 ;;
esac
log "ufw $*"
case "$1" in
  default) echo "$2" >"$d/$3" ;;
  limit|allow) grep -qx "ufw $*" "$d/rules" || echo "ufw $*" >>"$d/rules" ;;
  --force) echo active >"$d/status" ;;
esac`,
};

function criarBinFalso() {
  const bin = novoDiretorio('bin-falso');
  for (const [nome, corpo] of Object.entries(FALSOS)) {
    const cabecalho =
      '#!/bin/sh\nR="$LEILAO_VPS_RAIZ"\nlog() { printf \'%s\\n\' "$*" >>"$FAKE_LOG"; }\n';
    writeFileSync(join(bin, nome), `${cabecalho}${corpo}\n`, { mode: 0o755 });
  }
  return bin;
}
const BIN_FALSO = criarBinFalso();

const escrever = (raiz, relativo, conteudo, permissao = 0o644) => {
  const caminho = join(raiz, relativo);
  mkdirSync(join(caminho, '..'), { recursive: true });
  writeFileSync(caminho, conteudo, { mode: permissao });
  chmodSync(caminho, permissao);
};

// Servidor limpo da Hostinger, ou o estado de 2026-10-25 com o que o humano fez à mão.
function criarServidor({ feitoAMao = false, adminUid = 1000, comChave = true, extras = {} } = {}) {
  const raiz = novoDiretorio('vps');
  escrever(raiz, 'etc/os-release', 'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n');
  const usuarios = [`eliel:x:${adminUid}:${adminUid}::/home/eliel:/bin/bash`];
  const grupos = ['sudo:x:27:eliel'];
  if (feitoAMao) {
    usuarios.push('deploy:x:1001:1001::/home/deploy:/bin/bash');
    grupos.push('deploy:x:1001:', 'docker:x:999:deploy');
  }
  escrever(raiz, 'etc/passwd', `${usuarios.join('\n')}\n`);
  escrever(raiz, 'etc/group', `${grupos.join('\n')}\n`);
  if (comChave)
    escrever(raiz, 'home/eliel/.ssh/authorized_keys', 'ssh-ed25519 AAAA teste\n', 0o600);
  escrever(raiz, 'etc/default/ufw', `IPV6=${feitoAMao ? 'yes' : 'no'}\n`);
  const pacotes = [
    'ufw',
    ...(feitoAMao ? ['docker-ce', 'docker-compose-plugin', 'unattended-upgrades'] : []),
  ];
  escrever(raiz, 'fake/dpkg', `${pacotes.join('\n')}\n`);
  escrever(raiz, 'fake/ufw/status', feitoAMao ? 'active\n' : 'inactive\n');
  escrever(raiz, 'fake/ufw/incoming', feitoAMao ? 'deny\n' : 'allow\n');
  escrever(raiz, 'fake/ufw/outgoing', 'allow\n');
  escrever(
    raiz,
    'fake/ufw/rules',
    feitoAMao ? 'ufw limit 22/tcp\nufw allow 80/tcp\nufw allow 443/tcp\n' : '',
  );
  const swaps = 'Filename\tType\tSize\tUsed\tPriority\n';
  escrever(raiz, 'proc/swaps', feitoAMao ? `${swaps}/swapfile\tfile\t2097148\t0\t-2\n` : swaps);
  escrever(raiz, 'etc/fstab', feitoAMao ? '/swapfile none swap sw 0 0\n' : '# fstab\n');
  if (feitoAMao) escrever(raiz, 'swapfile', '', 0o600);
  mkdirSync(join(raiz, 'etc/ssh/sshd_config.d'), { recursive: true });
  if (feitoAMao) {
    escrever(
      raiz,
      'etc/ssh/sshd_config.d/00-leilao.conf',
      'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nAllowUsers eliel deploy\n',
    );
  }
  for (const dir of ['etc/apt/apt.conf.d', 'etc/systemd', 'opt', 'var/backups']) {
    mkdirSync(join(raiz, dir), { recursive: true });
  }
  for (const [relativo, conteudo] of Object.entries(extras)) escrever(raiz, relativo, conteudo);
  return raiz;
}

// Retrato do sandbox: tipo, modo e conteúdo de cada caminho.
function retrato(raiz, relativo = '') {
  return readdirSync(join(raiz, relativo))
    .sort()
    .flatMap((nome) => {
      const atual = join(relativo, nome);
      const info = lstatSync(join(raiz, atual));
      const modoTexto = (info.mode & 0o7777).toString(8);
      if (info.isDirectory()) return [`d ${modoTexto} ${atual}`, ...retrato(raiz, atual)];
      return [`f ${modoTexto} ${atual} ${readFileSync(join(raiz, atual), 'utf8')}`];
    });
}

function preparar(raiz, args, env = {}) {
  const log = join(raiz, '..', `${raiz.split('/').at(-1)}.log`);
  if (!existsSync(log)) writeFileSync(log, '');
  const saida = spawnSync('bash', [PREPARADOR, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${BIN_FALSO}:${process.env.PATH}`,
      HOME: process.env.HOME,
      LC_ALL: 'C.UTF-8',
      LEILAO_VPS_RAIZ: raiz,
      LEILAO_VPS_DONO: `${UID}:${GID}`,
      FAKE_LOG: log,
      ...env,
    },
  });
  return { ...saida, log: readFileSync(log, 'utf8') };
}

const ler = (raiz, relativo) => readFileSync(join(raiz, relativo), 'utf8');
const lerRepo = (relativo) => readFileSync(join(RAIZ_DO_REPO, relativo), 'utf8');

describe('preparar-vps.sh', () => {
  it('--dry-run num servidor limpo só imprime: nada muda e nenhum comando que altera roda', () => {
    const raiz = criarServidor();
    const antes = retrato(raiz);
    const saida = preparar(raiz, ['--dry-run', 'eliel']);
    assert.equal(saida.status, 0, saida.stderr);
    assert.deepEqual(retrato(raiz), antes);
    assert.equal(saida.log, '');
    assert.match(saida.stdout, /dry-run concluído: [1-9]\d* alterações seriam feitas/);
    assert.match(saida.stdout, /\[dry-run\] .*apt-get install .*docker-ce/);
  });

  it('num servidor limpo aplica tudo, e a segunda execução não muda nada', () => {
    const raiz = criarServidor();
    const primeira = preparar(raiz, ['eliel']);
    assert.equal(primeira.status, 0, primeira.stderr);

    assert.equal(
      ler(raiz, 'etc/ssh/sshd_config.d/00-leilao.conf'),
      lerRepo('infra/vps/sshd/00-leilao.conf').replace('@ADMIN@', 'eliel'),
    );
    assert.match(ler(raiz, 'etc/ssh/sshd_config.d/00-leilao.conf'), /^AllowUsers eliel deploy$/m);
    assert.equal(
      ler(raiz, 'etc/apt/apt.conf.d/52leilao-unattended-upgrades'),
      lerRepo('infra/vps/apt/52leilao-unattended-upgrades'),
    );
    assert.match(ler(raiz, 'etc/apt/apt.conf.d/21leilao-auto-upgrades'), /Unattended-Upgrade "1"/);
    assert.match(ler(raiz, 'etc/systemd/journald.conf.d/00-leilao.conf'), /^SystemMaxUse=500M$/m);
    assert.match(ler(raiz, 'etc/apt/sources.list.d/docker.sources'), /^Suites: noble$/m);
    assert.equal(modo(join(raiz, 'opt/leilao')), 0o755);
    assert.equal(modo(join(raiz, 'opt/leilao/bin')), 0o755);
    assert.equal(modo(join(raiz, 'var/backups/leilao')), 0o700);
    assert.equal(modo(join(raiz, 'swapfile')), 0o600);
    assert.match(ler(raiz, 'etc/fstab'), /^\/swapfile none swap sw,nofail 0 0$/m);
    assert.match(ler(raiz, 'etc/passwd'), /^deploy:/m);
    assert.match(ler(raiz, 'etc/group'), /^docker:x:999:deploy$/m);
    assert.doesNotMatch(ler(raiz, 'etc/group'), /^sudo:.*deploy/m);
    assert.equal(ler(raiz, 'etc/default/ufw'), 'IPV6=yes\n');
    assert.equal(ler(raiz, 'fake/ufw/status'), 'active\n');
    assert.equal(ler(raiz, 'fake/ufw/incoming'), 'deny\n');
    assert.equal(
      ler(raiz, 'fake/ufw/rules'),
      'ufw limit 22/tcp\nufw allow 80/tcp\nufw allow 443/tcp\n',
    );
    assert.match(primeira.log, /^systemctl try-reload-or-restart ssh\.service$/m);
    assert.match(primeira.log, /^fallocate -l 2G /m);
    assert.doesNotMatch(primeira.log, /docker-buildx-plugin/);

    const antes = retrato(raiz);
    const segunda = preparar(raiz, ['eliel']);
    assert.equal(segunda.status, 0, segunda.stderr);
    assert.match(segunda.stdout, /concluído: 0 alterações/);
    assert.deepEqual(retrato(raiz), antes);
    assert.equal(segunda.log, primeira.log, 'nenhum comando que altera rodou na segunda vez');
  });

  it('sobre o que o humano fez à mão, só completa o que falta e depois fica estável', () => {
    const raiz = criarServidor({ feitoAMao: true });
    const seco = preparar(raiz, ['--dry-run', 'eliel']);
    assert.equal(seco.status, 0, seco.stderr);
    assert.equal(seco.log, '');

    const primeira = preparar(raiz, ['eliel']);
    assert.equal(primeira.status, 0, primeira.stderr);
    assert.doesNotMatch(primeira.log, /apt-get|useradd|usermod|swapon|fallocate|^ufw /m);
    assert.match(primeira.log, /^systemctl try-reload-or-restart ssh\.service$/m);

    const antes = retrato(raiz);
    const segunda = preparar(raiz, ['eliel']);
    assert.match(segunda.stdout, /concluído: 0 alterações/);
    assert.deepEqual(retrato(raiz), antes);
  });

  it('fstab e /etc/default/ufw sem quebra de linha final: a linha nova fica em linha própria, com backup do fstab, e é idempotente', () => {
    const fstabOriginal = 'UUID=abc / ext4 defaults 0 1';
    const raiz = criarServidor({
      extras: { 'etc/fstab': fstabOriginal, 'etc/default/ufw': 'DEFAULT_INPUT_POLICY="DROP"' },
    });
    const primeira = preparar(raiz, ['eliel']);
    assert.equal(primeira.status, 0, primeira.stderr);
    assert.equal(ler(raiz, 'etc/fstab'), `${fstabOriginal}\n/swapfile none swap sw,nofail 0 0\n`);
    assert.equal(ler(raiz, 'etc/default/ufw'), 'DEFAULT_INPUT_POLICY="DROP"\nIPV6=yes\n');
    const copias = readdirSync(join(raiz, 'etc')).filter((nome) => nome.startsWith('fstab.'));
    assert.equal(copias.length, 1, `uma cópia do fstab antes da alteração: ${copias}`);
    assert.equal(ler(raiz, join('etc', copias[0])), fstabOriginal);
    assert.match(primeira.log, /^fallocate umask 0077$/m, 'swapfile criado com umask 077');

    const antes = retrato(raiz);
    const segunda = preparar(raiz, ['eliel']);
    assert.equal(segunda.status, 0, segunda.stderr);
    assert.match(segunda.stdout, /concluído: 0 alterações/);
    assert.deepEqual(retrato(raiz), antes);
  });

  it('com sshd -t recusando, restaura o drop-in anterior e não recarrega o sshd', () => {
    const raiz = criarServidor({ feitoAMao: true });
    const anterior = ler(raiz, 'etc/ssh/sshd_config.d/00-leilao.conf');
    const saida = preparar(raiz, ['eliel'], { FAKE_SSHD_FALHA: '1' });
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /sshd -t recusou a configuração/);
    assert.equal(ler(raiz, 'etc/ssh/sshd_config.d/00-leilao.conf'), anterior);
    assert.doesNotMatch(saida.log, /systemctl .*ssh/);
  });

  it('tira o deploy do grupo sudo e avisa regras extras do UFW', () => {
    const raiz = criarServidor({ feitoAMao: true });
    escrever(raiz, 'etc/group', 'sudo:x:27:eliel,deploy\ndeploy:x:1001:\ndocker:x:999:deploy\n');
    escrever(
      raiz,
      'fake/ufw/rules',
      'ufw limit 22/tcp\nufw allow 80/tcp\nufw allow 443/tcp\nufw allow 8080/tcp\n',
    );
    const saida = preparar(raiz, ['eliel']);
    assert.equal(saida.status, 0, saida.stderr);
    assert.match(ler(raiz, 'etc/group'), /^sudo:x:27:eliel$/m);
    assert.match(saida.stdout, /regra extra no UFW.*ufw allow 8080\/tcp/);
  });

  const recusas = {
    'administrador com uid diferente de 1000': [{ adminUid: 1002 }, ['eliel'], /uid 1002/],
    'administrador sem chave SSH': [{ comChave: false }, ['eliel'], /authorized_keys/],
    'administrador inexistente': [{}, ['maria'], /maria não existe/],
    'deploy como administrador': [{}, ['deploy'], /não pode ser root nem deploy/],
    'nome inválido': [{}, ['eliel;rm'], /nome de administrador inválido/],
    'docker.io do Ubuntu instalado': [
      { extras: { 'fake/dpkg': 'ufw\ndocker.io\n' } },
      ['eliel'],
      /conflitam com o Docker oficial: docker.io/,
    ],
  };
  for (const [caso, [opcoes, args, erro]] of Object.entries(recusas)) {
    it(`sai 1 sem alterar nada: ${caso}`, () => {
      const raiz = criarServidor(opcoes);
      const antes = retrato(raiz);
      const saida = preparar(raiz, args);
      assert.equal(saida.status, 1, saida.stdout);
      assert.match(saida.stderr, erro);
      assert.deepEqual(retrato(raiz), antes);
      assert.equal(saida.log, '');
    });
  }

  it('sem administrador ou com opção desconhecida sai 2', () => {
    const raiz = criarServidor();
    assert.equal(preparar(raiz, []).status, 2);
    assert.equal(preparar(raiz, ['--forcar', 'eliel']).status, 2);
  });

  it('administrador sem sudo sai 1 antes de qualquer mudança', () => {
    const raiz = criarServidor({ extras: { 'etc/group': 'sudo:x:27:\n' } });
    const antes = retrato(raiz);
    const saida = preparar(raiz, ['eliel']);
    assert.equal(saida.status, 1);
    assert.match(saida.stderr, /não está no grupo sudo/);
    assert.deepEqual(retrato(raiz), antes);
  });
});
