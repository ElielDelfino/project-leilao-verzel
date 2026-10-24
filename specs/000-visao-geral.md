# 000 — Visão geral

Status: aprovada
Depende de: —

## Contexto
Casa de Leilões online construída como teste técnico Elite Dev da Verzel (recebido em 2026-10-22, entrega até **2026-10-29 23:59**). Um leiloeiro publica lotes de **cartas de Magic: The Gathering** obtidas da API pública da Scryfall, e licitantes disputam cada lote com lances ao vivo usando saldo simulado. Qualquer pessoa, sem login, pode auditar o histórico de lances de um lote e verificar que ele não foi adulterado.

## Usuários
| Papel | Pode | Não pode |
|---|---|---|
| Leiloeiro (vendedor) | buscar cartas, criar, cancelar e acompanhar os próprios lotes; ver resultado e total recebido | dar lances; depositar saldo |
| Licitante (cliente) | depositar saldo simulado, dar lances, arrematar, ver comprovantes e compartilhá-los | criar lotes |
| Público anônimo | ver a vitrine e a sala (só leitura), auditar lotes, abrir comprovantes compartilhados | qualquer escrita |

O papel é escolhido no cadastro e não muda. Não existe administrador (ADR 0006).

## Escopo (MVP = tudo abaixo; não há plano de corte)
- RF-01 Vitrine com lotes ao vivo, agendados e encerrados; cancelados nunca aparecem.
- RF-02 Painel do leiloeiro: buscar na Scryfall, criar lote (imagem, título, atributos, início, fim, lance inicial, incremento mínimo), cancelar lote, ver o resultado de cada lote encerrado e o total recebido.
- RF-03 Sala do lote ao vivo: lance atual, histórico, posição do usuário, contagem regressiva, "você está ganhando" / "você foi superado", tudo sem recarregar.
- RF-04 Carteira: saldo total, comprometido, disponível e depósito simulado.
- RF-05 Meus arremates: lotes em que o licitante deu lance e lotes vencidos, com comprovante e link de compartilhamento.
- RF-06 Auditoria pública: histórico completo de um lote com o veredito "íntegro" ou "adulterado".
- RF-07 Mensagem clara para cada lance recusado: abaixo do mínimo, saldo insuficiente, você já está ganhando, lote não iniciado, lote encerrado.
- RF-08 (opcional, incluído) Busca e filtro de lotes.
- RF-09 (opcional, incluído) Cancelamento de lote com estorno automático.
- RF-10 (opcional, incluído) Docker Compose.
- RF-11 (opcional, incluído) Testes automatizados.
- RF-12 (opcional, incluído) Dark mode.
- RF-13 Seed: 1 leiloeiro, 2 licitantes e pelo menos 1 lote publicado com lances abertos.
- RF-14 Deploy público obrigatório e README detalhado (setup, técnica antiadulteração, comportamentos inesperados, uso de IA).

## Fora de escopo
Nota fiscal, revenda entre usuários, aplicativo nativo, recuperação de senha (definidos pelo PDF), exclusão de conta, administrador, pagamentos reais, internacionalização.

## Requisitos não funcionais
| ID | Requisito | Meta verificável |
|---|---|---|
| RNF-01 | Concorrência | 50 usuários simultâneos por lote, 200 no total (ADR 0014, provisória) |
| RNF-02 | Latência do lance | p95 < 300 ms medido no servidor (k6) |
| RNF-03 | Tempo real | lance aceito aparece nos outros clientes em < 1 s |
| RNF-04 | Resiliência à API externa | vitrine, salas, auditoria e comprovante funcionam 100% com a Scryfall fora |
| RNF-05 | Dinheiro | sempre em centavos inteiros (BRL), nunca float |
| RNF-06 | Idioma | só pt-BR |
| RNF-07 | Acessibilidade | WCAG 2.2 AA nas telas de RF-01 a RF-07 |
| RNF-08 | Privacidade | auditoria e comprovante identificam licitantes só por pseudônimo; dados coletados: nome, e-mail, senha (hash argon2id) |
| RNF-09 | Retenção | lances, ledger e comprovantes permanentes; logs 14 dias; refresh tokens expirados expurgados diariamente; cache da Scryfall 24 h |
| RNF-10 | Encerramento | um lote é liquidado no máximo 1 s após o fim |
| RNF-11 | Custo | infraestrutura de produção com custo zero (free tier GCP) |

## Critérios de sucesso
- [ ] Todos os RFs demonstráveis no deploy usando as contas seed.
- [ ] README cobre setup, técnica antiadulteração, comportamentos inesperados e uso de IA.
- [ ] CI verde na main.
- [ ] Teste de carga k6 atinge RNF-01 a RNF-03.

## Decisões relacionadas
- decisions/0001-decisoes-iniciais.md, 0002-api-externa-scryfall.md, 0014-rnfs-de-demo.md
