# 006 — Lotes

Status: aprovada
Depende de: 003, 004, 005

## Requisitos
- RF-01 O leiloeiro cria um lote a partir de uma carta: título (default = nome da carta), descrição opcional, lance inicial, incremento mínimo, início e fim.
- RF-02 Vitrine pública separada em ao vivo, agendados e encerrados; cancelados nunca aparecem.
- RF-03 Busca e filtro: texto (título/carta), status, faixa de preço (lance atual ou inicial), raridade; ordenação por "termina antes", "mais recente" e "maior lance"; paginação de 24.
- RF-04 Cancelamento pelo dono enquanto agendado ou ao vivo. Com lances, faz **estorno automático** do compromisso do líder (specs/004) na mesma transação e sela o histórico com status `cancelado`.
- RF-05 Painel do leiloeiro: todos os seus lotes (inclusive cancelados), resultado de cada encerrado (arrematado ou não, por quanto) e total recebido.

## Comportamento
Validações na criação (422 `DADOS_INVALIDOS` com campo):
- lance inicial ≥ R$ 1,00; incremento ≥ R$ 1,00; ambos ≤ R$ 1.000.000,00;
- início ≥ agora − 1 min (aceita "agora"); fim ≥ início + 5 min; duração ≤ 7 dias.

Estados: `agendado → ao_vivo → encerrado`; `agendado|ao_vivo → cancelado`.
- As transições por tempo são feitas pelo job (specs/010). Para não depender dele, **a regra de lance usa os horários** (`inicio_em <= agora < fim_em`) sob lock, e a vitrine deriva o status dos horários.
- `fim_em` pode ser estendido pelo anti-sniping (specs/007); `fim_original_em` guarda o valor inicial.

## Interfaces e contratos
- `GET /api/lotes?status=&q=&precoMin=&precoMax=&raridade=&ordem=&pagina=` (público)
- `GET /api/lotes/{id}` (público; inclui o snapshot e, se autenticado, a posição do usuário)
- `POST /api/painel/lotes` (leiloeiro) → 201
- `POST /api/painel/lotes/{id}/cancelamento` (dono) → 200 · 409 `LOTE_ENCERRADO`
- `GET /api/painel/lotes?pagina=` (dono) e `GET /api/painel/resumo` → `{totalRecebidoCentavos, lotesArrematados, lotesSemLance}`

## Dados
- `lots(id uuid pk, leiloeiro_id fk, snapshot_id fk, titulo, descricao, lance_inicial_centavos, incremento_minimo_centavos, inicio_em, fim_em, fim_original_em, status status_lote, lance_atual_centavos null, lider_id null, total_lances int default 0, vencedor_id null, valor_arremate_centavos null, encerrado_em null, cancelado_em null, criado_em)`
- Índices: `(status, fim_em)`, `(status, inicio_em)`, `(leiloeiro_id, criado_em desc)`, trigram em `titulo`.
- Retenção: permanente.

## Critérios de aceite
- [ ] Lote cancelado some da vitrine e continua no painel do dono.
- [ ] Cancelar com líder devolve o comprometido ao disponível (evento `saldo_atualizado`).
- [ ] Filtros combinados retornam o resultado correto (testes de integração).

## Fora de escopo
Edição de lote depois de publicado; lotes com múltiplos itens; preço de reserva.

## Decisões relacionadas
- decisions/0001-decisoes-iniciais.md
