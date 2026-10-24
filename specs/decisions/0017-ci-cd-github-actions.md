# 0017 — CI/CD no GitHub Actions com deploy automático na main

Status: aceita
Data: 2026-10-24

## Decisão
PR: `verify:full --e2e`, k6 smoke, `pnpm audit`, gitleaks (CodeQL e Dependabot no repositório). main: build → GHCR → SSH → segredos → migrate → `compose up -d` → health check → rollback automático se falhar. Ambientes: dev e prod.

## Alternativas consideradas
Deploy manual (fácil de esquecer perto do prazo); staging (não cabe no free tier).

## Consequências
A main precisa estar sempre implantável (trunk-based, ADR 0019).
