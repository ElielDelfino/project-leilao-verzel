#!/usr/bin/env python3
"""Hook PreToolUse dos agentes do projeto: bloqueia Edit/Write fora das pastas do papel.

Uso no frontmatter do agente:  python3 "${CLAUDE_PROJECT_DIR:-.}/scripts/agents/guard_paths.py" <papel>
Lê o JSON do hook no stdin. Sai com 0 (permite) ou 2 (bloqueia; a mensagem em stderr volta ao agente).
Fonte das regras: specs/002-organizacao-do-trabalho.md (tabela de propriedade) e ADR 0021.
Falha fechada: papel desconhecido, JSON inválido ou caminho fora do repositório bloqueiam.
"""
import json
import os
import subprocess
import sys
from fnmatch import fnmatchcase

# Comuns a todos os papéis executores: entrada no CHANGELOG (DoD) e manifesto/lockfile da raiz.
COMUNS = ["CHANGELOG.md", "package.json", "pnpm-lock.yaml"]

# Em fnmatch, "*" também casa "/", então "apps/api/*" cobre toda a subárvore.
REGRAS = {
    "spec-guardian": {
        "permitir": ["specs/*", "apps/api/openapi.yaml", "eventbus/*", "docs/*", "README.md", "CHANGELOG.md"],
        "negar": [],
    },
    "api-dev": {
        "permitir": ["apps/api/*", "packages/contracts/*"] + COMUNS,
        "negar": ["apps/api/openapi.yaml", "apps/api/src/*schema.ts", "apps/api/drizzle.config.ts",
                  "apps/api/src/db/*", "apps/api/Dockerfile", "apps/api/test/setup/*"],
    },
    "web-dev": {
        "permitir": ["apps/web/*"] + COMUNS,
        "negar": ["apps/web/Dockerfile"],
    },
    "db-dev": {
        "permitir": ["database/*", "cache/*", "apps/api/src/*schema.ts", "apps/api/drizzle.config.ts",
                     "apps/api/src/db/*"] + COMUNS,
        "negar": ["database/*/docker-compose.yml", "cache/*/docker-compose.yml"],
    },
    "qa": {
        "permitir": ["apps/*/test/*", "e2e/*", "load/*", "scripts/verify.mjs", "vitest.workspace.ts",
                     "vitest.config.*", "playwright.config.*"] + COMUNS,
        "negar": [],
    },
    "orquestrador": {
        "permitir": ["tasks/*", "tmp/*", "CHANGELOG.md"],
        "negar": [],
    },
    "infra": {
        "permitir": ["infra/*", ".github/*", "docker-compose.yml", "*/docker-compose.yml", "docker-compose.*.yml",
                     ".env", ".dockerignore", ".gitignore", "apps/*/Dockerfile", "scripts/*",
                     "pnpm-workspace.yaml", ".npmrc", ".nvmrc", "tsconfig.base.json", "eslint.config.mjs",
                     ".prettierrc", ".prettierignore", "lefthook.yml", "commitlint.config.mjs", ".editorconfig",
                     "LICENSE", "apps/*/package.json", "packages/*/package.json", "apps/*/tsconfig.json",
                     "packages/*/tsconfig.json", "docs/dev-setup.md", "docs/deploy.md",
                     "docs/variaveis-de-ambiente.md"] + COMUNS,
        "negar": ["scripts/verify.mjs", "scripts/agents/*"],
    },
}

# Ninguém altera: definições de agentes, o próprio guard e segredos locais.
# A fila (tasks/) só aparece no "permitir" do orquestrador.
PROIBIDOS_PARA_TODOS = [".claude/*", "scripts/agents/*", ".env.local", ".env.*.local", "*.pem", "*.key"]


def bloquear(motivo: str) -> None:
    print(f"[guard_paths] BLOQUEADO: {motivo}. Veja specs/002 (propriedade por papel). "
          "Se a tarefa exige este arquivo, pare e reporte status 'bloqueada'.", file=sys.stderr)
    sys.exit(2)


def raiz_do_repo(cwd: str) -> str:
    try:
        saida = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"],
                               capture_output=True, text=True, timeout=5)
        if saida.returncode == 0 and saida.stdout.strip():
            return saida.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return os.environ.get("CLAUDE_PROJECT_DIR") or cwd


def caminhos_alvo(entrada: dict) -> list:
    tool_input = entrada.get("tool_input") or {}
    caminhos = [tool_input.get("file_path"), tool_input.get("notebook_path")]
    return [c for c in caminhos if c]


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in REGRAS:
        bloquear(f"papel desconhecido {sys.argv[1:]!r}")
    regra = REGRAS[sys.argv[1]]
    try:
        entrada = json.load(sys.stdin)
    except json.JSONDecodeError:
        bloquear("entrada do hook não é JSON válido")
    cwd = entrada.get("cwd") or os.getcwd()
    raiz = raiz_do_repo(cwd)
    alvos = caminhos_alvo(entrada)
    if not alvos:
        bloquear("não foi possível identificar o arquivo alvo")
    for alvo in alvos:
        absoluto = os.path.normpath(alvo if os.path.isabs(alvo) else os.path.join(cwd, alvo))
        relativo = os.path.relpath(absoluto, raiz).replace(os.sep, "/")
        if relativo.startswith("../") or relativo == "..":
            bloquear(f"'{alvo}' está fora do repositório")
        if any(fnmatchcase(relativo, p) for p in PROIBIDOS_PARA_TODOS):
            bloquear(f"'{relativo}' é proibido para todos os agentes")
        if any(fnmatchcase(relativo, p) for p in regra["negar"]):
            bloquear(f"'{relativo}' pertence a outro papel")
        if not any(fnmatchcase(relativo, p) for p in regra["permitir"]):
            bloquear(f"'{relativo}' está fora das pastas do papel {sys.argv[1]}")
    sys.exit(0)


if __name__ == "__main__":
    main()
