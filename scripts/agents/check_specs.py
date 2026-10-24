#!/usr/bin/env python3
"""Verifica a consistência de specs, ADRs, tarefas e links. Uso: python3 scripts/agents/check_specs.py
Sai com 0 se tudo estiver consistente, 1 caso contrário. Usado pelo spec-guardian e pelo orquestrador."""
import glob
import os
import re
import sys

falhas = []


def falha(msg: str) -> None:
    falhas.append(msg)


def ler(caminho: str) -> str:
    with open(caminho, encoding="utf-8") as f:
        return f.read()


specs = {os.path.basename(p) for p in glob.glob("specs/[0-9][0-9][0-9]-*.md")}
indexadas = set(re.findall(r"\]\((\d{3}-[^)]+\.md)\)", ler("specs/INDEX.md")))
for f in sorted(specs ^ indexadas):
    falha(f"INDEX e specs/ divergem em {f}")

adrs = {os.path.basename(p) for p in glob.glob("specs/decisions/[0-9][0-9][0-9][0-9]-*.md")}
historico = set(re.findall(r"\]\((\d{4}-[^)]+\.md)\)", ler("specs/decisions/HISTORY.md")))
for f in sorted(adrs ^ historico):
    falha(f"HISTORY e specs/decisions/ divergem em {f}")

markdowns = [p for p in glob.glob("**/*.md", recursive=True) + glob.glob(".claude/agents/*.md")
             if not p.startswith(("learning/", "node_modules/", "tmp/"))]
for p in markdowns:
    texto, base = ler(p), os.path.dirname(p)
    for link in re.findall(r"\]\(([^)#\s]+)\)", texto):
        if not link.startswith("http") and not os.path.exists(os.path.normpath(os.path.join(base, link))):
            falha(f"{p}: link quebrado {link}")
    for ref in re.findall(r"(\d{4}-[a-z0-9-]+\.md)", texto):
        if ref not in adrs:
            falha(f"{p}: ADR inexistente {ref}")
    for num in set(re.findall(r"\bADR (\d{4})", texto)):
        if not glob.glob(f"specs/decisions/{num}-*.md"):
            falha(f"{p}: ADR {num} inexistente")
    for num in set(re.findall(r"specs/(\d{3})\b", texto)):
        if not glob.glob(f"specs/{num}-*.md"):
            falha(f"{p}: spec {num} inexistente")
    if p.startswith("specs/") and re.search(r"\bTODO\b|\bTBD\b|[Aa] definir", texto):
        falha(f"{p}: pendência 'a definir' sem ADR")

ids = {os.path.basename(p)[:3] for p in glob.glob("tasks/[0-9][0-9][0-9]-*.md")}
for p in glob.glob("tasks/[0-9][0-9][0-9]-*.md"):
    texto = ler(p)
    dep = re.search(r"depende-de: \[(.*)\]", texto)
    spec = re.search(r"spec: (\S+)", texto)
    if not dep or not spec:
        falha(f"{p}: frontmatter incompleto")
        continue
    for d in re.findall(r"\d{3}", dep.group(1)):
        if d not in ids and os.path.exists(f"tasks/{d}"):
            falha(f"{p}: dependência {d} inexistente")
    if not os.path.exists(spec.group(1)):
        falha(f"{p}: spec {spec.group(1)} inexistente")

for f in falhas:
    print("✗", f)
print(f"{len(specs)} specs, {len(adrs)} ADRs, {len(ids)} tarefas, {len(markdowns)} markdowns → "
      + ("OK" if not falhas else f"{len(falhas)} falha(s)"))
sys.exit(1 if falhas else 0)
