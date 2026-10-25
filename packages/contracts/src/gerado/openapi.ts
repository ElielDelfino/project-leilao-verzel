// Arquivo gerado por `pnpm contracts:gen` a partir de apps/api/openapi.yaml. Não edite à mão.
export interface paths {
  '/api/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Processo vivo, sem consultar dependências (specs/014 §Observabilidade) */
    get: operations['healthLive'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Pronto (Postgres e Redis respondendo; specs/014 §Observabilidade)
     * @description Cada verificação tem 2 s para responder. Com qualquer dependência fora, ou sem verificações
     *     registradas, responde 503 `INDISPONIVEL` sem `detalhes`: a resposta não diz qual dependência
     *     falhou (o nome e o motivo vão só para o log).
     */
    get: operations['healthReady'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/csrf': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Emite um cookie `csrf_token` novo, sem autenticação (specs/003)
     * @description A SPA chama esta rota antes do primeiro POST, inclusive antes do cadastro e do login.
     */
    get: operations['authCsrf'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/cadastro': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Cadastro público com papel imutável (specs/003 RF-01)
     * @description Limite de 5 cadastros por minuto por IP (specs/003 RNF-04).
     */
    post: operations['authCadastro'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Login por e-mail e senha (specs/003 RF-02)
     * @description Mesma resposta para e-mail inexistente e senha errada (specs/003 RNF-03).
     *     Limite de 5 tentativas por minuto por IP + e-mail (specs/003 RNF-02).
     */
    post: operations['authLogin'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/refresh': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Troca o refresh token por um par novo, na mesma família (specs/003)
     * @description Lê o cookie `refresh_token`. Reuso de um token já substituído revoga a família inteira e
     *     responde 401 `SESSAO_EXPIRADA`.
     */
    post: operations['authRefresh'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Encerra a sessão e revoga a família do refresh token (specs/003)
     * @description Lê o cookie `refresh_token` (Path=/api/auth) e revoga a família dele, se houver. Responde 204
     *     mesmo sem sessão e expira os três cookies com os mesmos Path com que foram emitidos.
     */
    post: operations['authLogout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Usuário da sessão atual (specs/003 RF-02) */
    get: operations['authMe'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/carteira': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Saldo do usuário, para os dois papéis (specs/004 RF-01, RF-02)
     * @description disponivelCentavos = totalCentavos − comprometidoCentavos.
     */
    get: operations['carteiraSaldo'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/carteira/depositos': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Depósito simulado, só licitante (specs/004 RF-03)
     * @description Valor entre 100 e 10.000.000 centavos (R$ 1,00 a R$ 100.000,00) por operação.
     *     Idempotente por (usuário, `Idempotency-Key`): repetir a chave com o mesmo corpo responde 200
     *     com o mesmo lançamento e o saldo atual; repetir a chave com corpo diferente responde 422
     *     `DADOS_INVALIDOS`. Nos dois casos, nenhum lançamento novo é gravado (specs/004).
     *     Leiloeiro recebe 403 `PAPEL_NAO_PERMITIDO`.
     */
    post: operations['carteiraDepositar'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/carteira/extrato': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Lançamentos do ledger do usuário, paginados, para os dois papéis (specs/004)
     * @description Ordem do mais recente para o mais antigo; 20 lançamentos por página (`meta.limite` = 20).
     */
    get: operations['carteiraExtrato'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/catalogo/cartas': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Busca de cartas na Scryfall, só leiloeiro (specs/005 RF-01)
     * @description `q` de 1 a 200 caracteres (sintaxe da Scryfall) e `pagina` de 1 a 500; 25 cartas por página
     *     (`meta.limite` = 25), mapeadas sobre as páginas de 175 da Scryfall (specs/005 §Busca). Nenhuma
     *     carta, ou página além da última, é 200 com lista vazia e `total` 0. Sintaxe recusada pela
     *     Scryfall é 422 com `detalhes.campo` `q`. Ordem: validação, cache (responde mesmo com o
     *     circuito aberto), circuito, ficha do bucket, chamada à Scryfall. Todo 503 de catálogo leva
     *     `detalhes.tenteNovamenteEm` e o header `Retry-After` com o mesmo valor. `imagemUrl` é a
     *     miniatura da própria Scryfall (ADR 0029), sem passar pelo servidor.
     */
    get: operations['catalogoBuscarCartas'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/imagens/{snapshotId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Imagem `normal` do snapshot da carta, pública (specs/005)
     * @description Bytes do JPEG ou PNG gravado no snapshot, sem o envelope. Imutável: `Cache-Control: public,
     *     max-age=31536000, immutable`; `ETag` é o SHA-256 dos bytes em hexadecimal minúsculo entre
     *     aspas. `If-None-Match` igual ao `ETag` responde 304 sem corpo. Id inexistente, ou que não é
     *     UUID, responde 404 `NAO_ENCONTRADO`. Nunca chama a Scryfall.
     */
    get: operations['imagemDoSnapshot'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/lotes': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Vitrine pública de lotes, com busca, filtros e ordenação (specs/006 RF-02, RF-03)
     * @description 24 lotes por página (`meta.limite` = 24); `pagina` além da última é 200 com lista vazia. O
     *     `status` é derivado dos horários (specs/006 §Estados e status derivado); sem `status`, vêm
     *     os três; cancelados nunca aparecem. `q` busca `ILIKE %q%` em título e nome da carta, com `%`,
     *     `_` e `\` literais. A faixa de preço usa `coalesce(lance atual, lance inicial)`, em centavos,
     *     fechada nas duas pontas. Desempate de toda ordenação: `id` decrescente. Nenhum nome nem
     *     e-mail de usuário na resposta.
     */
    get: operations['lotesListar'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/lotes/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Detalhe do lote, público com sessão opcional (specs/006 §Detalhe)
     * @description Sessão opcional (`@SessaoOpcional()`, specs/003): sem cookie, ou com cookie inválido ou
     *     expirado, responde 200 como anônimo; nunca 401. Lote `cancelado` é 200 com `status`
     *     `cancelado`. Id inexistente, ou que não é UUID, é 404 `NAO_ENCONTRADO`. `suaPosicao` é
     *     `ganhando` (lote ao vivo e o usuário lidera), `venceu` (lote encerrado e o usuário venceu) ou
     *     `null`. Sem nome nem e-mail de usuário.
     */
    get: operations['lotesDetalhar'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/lotes/{id}/lances': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Histórico público de lances do lote, pseudonimizado (specs/007)
     * @description Por `seq` decrescente, **50 por página** (`meta.limite` = 50); `pagina` de 1 a 500; além da
     *     última, 200 com lista vazia e o `total` real. Só pseudônimo: nunca nome, e-mail nem id de
     *     usuário. Lote inexistente, ou id que não é UUID, é 404 `NAO_ENCONTRADO`; `pagina` fora do
     *     intervalo é 422 com `detalhes.campo` `pagina`. Nunca cacheada (`Cache-Control: no-store`),
     *     porque o lote pode estar ao vivo.
     */
    get: operations['lancesListarDoLote'];
    put?: never;
    /**
     * Dá um lance no lote, só licitante (specs/007)
     * @description Uma transação com `FOR UPDATE` no lote (specs/007 §Transação). Antes dela, nesta ordem: CSRF
     *     (403 `CSRF_INVALIDO`), sessão (401), papel (403 `LEILOEIRO_NAO_PODE_LANCAR`; a rota não usa o
     *     `PAPEL_NAO_PERMITIDO` global, ADR 0031), validação (422 `DADOS_INVALIDOS`: `valorCentavos`
     *     inteiro de 1 a 9007199254740991 e `Idempotency-Key` UUID obrigatório), limite de 10 tentativas
     *     por segundo por usuário (429 `MUITAS_TENTATIVAS` com `Retry-After: 1`; Redis fora → 500
     *     `INDISPONIVEL`) e lote inexistente ou id que não é UUID (404 `NAO_ENCONTRADO`).
     *
     *     Dentro da transação, depois do lock: repetição da `Idempotency-Key` com o mesmo lote e o mesmo
     *     valor → 200 com o `lance` original e o `lote` atual, sem efeito novo; outro lote ou outro valor
     *     → 422 `DADOS_INVALIDOS`. Depois, as recusas, nesta ordem, todas 422: `LOTE_ENCERRADO`,
     *     `LOTE_NAO_INICIADO`, `JA_ESTA_GANHANDO`, `LANCE_ABAIXO_DO_MINIMO` (`detalhes.minimoCentavos`) e
     *     `SALDO_INSUFICIENTE` (`detalhes.disponivelCentavos`). Contenção de lock além de 5 s → 503
     *     `INDISPONIVEL`. Lance aceito a menos de 2 minutos do fim estende o fim para agora + 2 minutos
     *     (o `fimEm` da resposta já é o novo).
     */
    post: operations['lancesAceitar'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/me/lances': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Lotes em que o licitante deu lance, com a posição atual (specs/007)
     * @description Um item por lote em que o usuário deu lance, ordenado por `meuUltimoLanceEm` decrescente
     *     (desempate `lote.id` decrescente); **24 por página** (`meta.limite` = 24); `pagina` de 1 a 500;
     *     além da última, 200 com lista vazia. Só licitante: leiloeiro recebe 403 `PAPEL_NAO_PERMITIDO`.
     *     `posicao` segue a tabela de specs/007 §Posição do usuário no lote. Nunca cacheada.
     */
    get: operations['meLancesListar'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auditoria/lotes/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Cadeia inteira de lances, selo e veredito do servidor, público (specs/008)
     * @description Devolve a cadeia **inteira, sem paginação** (ADR 0031): o navegador precisa de todos os lances
     *     para recalcular hashes e assinaturas. Lote cancelado ou sem lances tem auditoria (cadeia vazia,
     *     veredito `integro`). `selo` é null enquanto o lote não foi encerrado nem cancelado. O veredito
     *     reflete o banco no momento da consulta, por isso a resposta nunca é cacheada
     *     (`Cache-Control: no-store`). Lote inexistente, ou id que não é UUID, é 404 `NAO_ENCONTRADO`.
     *     Só pseudônimos: nenhum nome, e-mail nem id de usuário.
     */
    get: operations['auditoriaDoLote'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auditoria/chaves': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Chaves públicas Ed25519 que já assinaram lances ou selos, público (specs/008 §Chaves)
     * @description Lê `signing_keys`, ordenada por `ativaDesde` crescente (desempate `keyId`); a chave antiga
     *     continua publicada depois de uma rotação. `Cache-Control: public, max-age=60`. O navegador que
     *     encontrar um `keyId` ausente da lista refaz a consulta uma vez antes de acusar problema.
     */
    get: operations['auditoriaChaves'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/painel/lotes': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Lotes do próprio leiloeiro, inclusive cancelados (specs/006 RF-05)
     * @description Do mais recente para o mais antigo (`criado_em` decrescente, desempate `id` decrescente);
     *     24 por página (`meta.limite` = 24); `pagina` de 1 a 500; além da última, 200 com lista vazia.
     */
    get: operations['painelListarLotes'];
    put?: never;
    /**
     * Cria um lote a partir de uma carta, só leiloeiro (specs/006 RF-01)
     * @description Validação (422, `detalhes.campo` com o primeiro campo inválido) antes de qualquer chamada
     *     externa; depois o snapshot é preparado fora da transação e gravado junto com o lote, tudo
     *     ou nada (specs/005 §Snapshot). Falha no snapshot: 503 (`CATALOGO_OCUPADO` |
     *     `CATALOGO_INDISPONIVEL`, com `tenteNovamenteEm` e `Retry-After`) ou 422 com
     *     `detalhes.campo` `scryfallId` (carta inexistente ou sem imagem). Status gravado: `ao_vivo`
     *     se `inicioEm` ≤ agora, senão `agendado`. Sem `Idempotency-Key` na F2.
     */
    post: operations['painelCriarLote'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/painel/resumo': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Total recebido e contagens dos lotes encerrados do leiloeiro (specs/006 RF-05)
     * @description Conta só lotes do usuário com status gravado `encerrado`. Sem lote encerrado, os três
     *     valores são 0.
     */
    get: operations['painelResumo'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    /** Format: uuid */
    Uuid: string;
    /** @description Valor monetário em centavos inteiros (nunca float). Duplicado no asyncapi.yaml. */
    Centavos: number;
    /** Format: date-time */
    Instante: string;
    /** @enum {string} */
    Papel: 'leiloeiro' | 'licitante';
    /** Format: email */
    Email: string;
    Usuario: {
      id: components['schemas']['Uuid'];
      nome: string;
      email: components['schemas']['Email'];
      papel: components['schemas']['Papel'];
    };
    CadastroEntrada: {
      nome: string;
      /** @description Único, sem diferenciar maiúsculas. */
      email: components['schemas']['Email'];
      senha: string;
      papel: components['schemas']['Papel'];
    };
    LoginEntrada: {
      email: components['schemas']['Email'];
      senha: string;
    };
    RespostaUsuarioLogado: {
      /** @constant */
      sucesso: true;
      dados: {
        usuario: components['schemas']['Usuario'];
      };
    };
    Saldo: {
      totalCentavos: components['schemas']['Centavos'];
      comprometidoCentavos: components['schemas']['Centavos'];
      disponivelCentavos: components['schemas']['Centavos'];
    };
    DepositoEntrada: {
      valorCentavos: number;
    };
    /** @enum {string} */
    TipoLancamento:
      'deposito' | 'compromisso' | 'liberacao' | 'estorno' | 'debito_arremate' | 'credito_arremate';
    Lancamento: {
      id: components['schemas']['Uuid'];
      tipo: components['schemas']['TipoLancamento'];
      /** @description Sempre positivo; o efeito no saldo depende do tipo (specs/004 §Comportamento). */
      valorCentavos: number;
      /** @description Lote que causou o lançamento; null em depósitos. */
      loteId: components['schemas']['Uuid'] | null;
      criadoEm: components['schemas']['Instante'];
    };
    RespostaDeposito: {
      /** @constant */
      sucesso: true;
      dados: {
        lancamento: components['schemas']['Lancamento'];
        saldo: components['schemas']['Saldo'];
      };
    };
    EstadoDeSaude: {
      /** @constant */
      status: 'ok';
    };
    MetaPaginacao: {
      total: number;
      pagina: number;
      limite: number;
    };
    /**
     * @description Raridades da Scryfall (specs/006).
     * @enum {string}
     */
    Raridade: 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';
    /**
     * @description Status derivado dos horários (specs/006 §Estados e status derivado); `cancelado` só aparece
     *     no painel e no detalhe, nunca na vitrine.
     * @enum {string}
     */
    StatusLote: 'agendado' | 'ao_vivo' | 'encerrado' | 'cancelado';
    /** @description Carta do resultado da busca (specs/005). Ainda sem snapshot. */
    CartaDaBusca: {
      scryfallId: components['schemas']['Uuid'];
      nome: string;
      colecao: string;
      raridade: components['schemas']['Raridade'];
      tipo: string;
      artista: string | null;
      /**
       * @description Miniatura `small` na Scryfall (`https://cards.scryfall.io/...`; ADR 0029); null se a
       *     carta não tiver imagem.
       */
      imagemUrl: string | null;
    };
    /** @description Campos do snapshot da carta, sem a imagem (`catalogo.obterSnapshot`, specs/005). */
    Carta: {
      scryfallId: components['schemas']['Uuid'];
      nome: string;
      colecao: string;
      raridade: components['schemas']['Raridade'];
      tipo: string;
      textoOracle: string | null;
      artista: string | null;
    };
    /**
     * @description Resumo do lote (vitrine, painel e criação; specs/006). Nunca leva nome nem e-mail de
     *     usuário.
     */
    Lote: {
      id: components['schemas']['Uuid'];
      titulo: string;
      status: components['schemas']['StatusLote'];
      cartaNome: string;
      raridade: components['schemas']['Raridade'];
      /** @description `/api/imagens/{snapshotId}`. */
      imagemUrl: string;
      inicioEm: components['schemas']['Instante'];
      fimEm: components['schemas']['Instante'];
      lanceInicialCentavos: components['schemas']['Centavos'];
      incrementoMinimoCentavos: components['schemas']['Centavos'];
      /** @description Null enquanto não há lance. */
      lanceAtualCentavos: components['schemas']['Centavos'] | null;
      /** @description `coalesce(lanceAtualCentavos, lanceInicialCentavos)`, o preço da faixa e da ordem `maior_lance`. */
      precoAtualCentavos: components['schemas']['Centavos'];
      totalLances: number;
      /** @description Valor do arremate do lote encerrado com vencedor; null nos demais casos. */
      valorArremateCentavos: components['schemas']['Centavos'] | null;
      criadoEm: components['schemas']['Instante'];
    };
    /**
     * @description Detalhe do lote (specs/006 §Detalhe): os campos de `Lote` mais descrição, fim original, o
     *     snapshot da carta sem a imagem e a posição do usuário. Mude os campos de `Lote` junto.
     */
    LoteDetalhe: {
      id: components['schemas']['Uuid'];
      titulo: string;
      descricao: string | null;
      status: components['schemas']['StatusLote'];
      cartaNome: string;
      raridade: components['schemas']['Raridade'];
      carta: components['schemas']['Carta'];
      /** @description `/api/imagens/{snapshotId}`. */
      imagemUrl: string;
      inicioEm: components['schemas']['Instante'];
      fimEm: components['schemas']['Instante'];
      fimOriginalEm: components['schemas']['Instante'];
      lanceInicialCentavos: components['schemas']['Centavos'];
      incrementoMinimoCentavos: components['schemas']['Centavos'];
      lanceAtualCentavos: components['schemas']['Centavos'] | null;
      precoAtualCentavos: components['schemas']['Centavos'];
      totalLances: number;
      valorArremateCentavos: components['schemas']['Centavos'] | null;
      /**
       * @description `ganhando` (lote ao vivo e o usuário lidera), `venceu` (lote encerrado e o usuário
       *     venceu); null nos demais casos e para anônimos. Só as colunas de `lots` (specs/006).
       */
      suaPosicao: ('ganhando' | 'venceu') | null;
      criadoEm: components['schemas']['Instante'];
    };
    /** @description Corpo da criação do lote; limites e regras em specs/006 §Criação. */
    LoteEntrada: {
      scryfallId: components['schemas']['Uuid'];
      /** @description Opcional; ausente, null ou só espaços → o nome da carta, truncado em 120 caracteres. */
      titulo?: string | null;
      /** @description Opcional; vazia ou só espaços → sem descrição. */
      descricao?: string | null;
      lanceInicialCentavos: number;
      incrementoMinimoCentavos: number;
      /** @description Instante com fuso; não pode ser mais de 1 minuto no passado. */
      inicioEm: components['schemas']['Instante'];
      /** @description Pelo menos 5 minutos depois de `inicioEm` e no máximo 7 dias depois. */
      fimEm: components['schemas']['Instante'];
    };
    RespostaListaDeLotes: {
      /** @constant */
      sucesso: true;
      dados: components['schemas']['Lote'][];
      meta: components['schemas']['MetaPaginacao'];
    };
    /** @description Só lotes do usuário com status gravado `encerrado` (specs/006 §Painel). */
    ResumoDoPainel: {
      totalRecebidoCentavos: components['schemas']['Centavos'];
      lotesArrematados: number;
      lotesSemLance: number;
    };
    /** @description Pseudônimo estável por lote (specs/008). Duplicado no asyncapi.yaml. */
    Pseudonimo: string;
    /** @description Corpo do lance; campo desconhecido é 422 `DADOS_INVALIDOS`. */
    LanceEntrada: {
      valorCentavos: number;
    };
    /** @description Lance pseudonimizado (specs/007). Nunca leva o id interno, o id do licitante, nome nem e-mail. */
    Lance: {
      seq: number;
      pseudonimo: components['schemas']['Pseudonimo'];
      valorCentavos: components['schemas']['Centavos'];
      /** @description ISO 8601 UTC com 3 casas de milissegundo (a forma assinada, specs/008). */
      criadoEm: components['schemas']['Instante'];
    };
    /** @description Estado do lote logo depois do lance aceito (`fimEm` já com a extensão, se houve). */
    LoteDoLance: {
      lanceAtualCentavos: components['schemas']['Centavos'];
      fimEm: components['schemas']['Instante'];
      totalLances: number;
    };
    RespostaLance: {
      /** @constant */
      sucesso: true;
      dados: {
        lance: components['schemas']['Lance'];
        lote: components['schemas']['LoteDoLance'];
      };
    };
    RespostaListaDeLances: {
      /** @constant */
      sucesso: true;
      dados: components['schemas']['Lance'][];
      meta: components['schemas']['MetaPaginacao'];
    };
    /**
     * @description Posição em um lote em que o usuário deu lance (specs/007 §Posição do usuário no lote);
     *     `sem_lance` não aparece aqui porque a lista só traz lotes com lance do usuário.
     * @enum {string}
     */
    PosicaoDoLicitante: 'ganhando' | 'superado' | 'venceu' | 'perdeu';
    LanceDoUsuario: {
      lote: components['schemas']['Lote'];
      posicao: components['schemas']['PosicaoDoLicitante'];
      meuMaiorLanceCentavos: components['schemas']['Centavos'];
      meuUltimoLanceEm: components['schemas']['Instante'];
    };
    RespostaMeusLances: {
      /** @constant */
      sucesso: true;
      dados: components['schemas']['LanceDoUsuario'][];
      meta: components['schemas']['MetaPaginacao'];
    };
    /** @description SHA-256 em 64 caracteres hexadecimais minúsculos (specs/008 §Forma canônica). */
    HashHex: string;
    /** @description Assinatura Ed25519 de 64 bytes em base64url sem padding (86 caracteres). */
    AssinaturaBase64Url: string;
    /** @description Os 16 primeiros caracteres hex minúsculos de SHA-256 da chave pública (specs/008 §Chaves). */
    KeyId: string;
    /** @description Lance com os campos de integridade (specs/008), para recalcular a cadeia no navegador. */
    LanceDaCadeia: {
      seq: number;
      pseudonimo: components['schemas']['Pseudonimo'];
      valorCentavos: components['schemas']['Centavos'];
      criadoEm: components['schemas']['Instante'];
      hashAnterior: components['schemas']['HashHex'];
      hash: components['schemas']['HashHex'];
      assinatura: components['schemas']['AssinaturaBase64Url'];
      keyId: components['schemas']['KeyId'];
    };
    /** @description Selo assinado no encerramento ou no cancelamento (specs/008 §Técnica). */
    SeloDoLote: {
      /** @enum {string} */
      status: 'encerrado' | 'cancelado';
      totalLances: number;
      /** @description `hash` do último lance, ou o hash da gênese se `totalLances` for 0. */
      hashFinal: components['schemas']['HashHex'];
      /** @description Null em lote cancelado ou sem lance. */
      vencedorPseudonimo: components['schemas']['Pseudonimo'] | null;
      /** @description Null em lote cancelado ou sem lance. */
      valorArremateCentavos: components['schemas']['Centavos'] | null;
      seladoEm: components['schemas']['Instante'];
      assinatura: components['schemas']['AssinaturaBase64Url'];
      keyId: components['schemas']['KeyId'];
    };
    /**
     * @description Códigos da verificação, iguais no servidor e no navegador (specs/008 §Verificação).
     * @enum {string}
     */
    CodigoDeProblema:
      | 'SEQ_FORA_DE_ORDEM'
      | 'HASH_ANTERIOR_DIVERGENTE'
      | 'HASH_DIVERGENTE'
      | 'ASSINATURA_INVALIDA'
      | 'CHAVE_DESCONHECIDA'
      | 'SELO_TOTAL_DIVERGENTE'
      | 'SELO_HASH_FINAL_DIVERGENTE'
      | 'SELO_ASSINATURA_INVALIDA';
    ProblemaDeIntegridade: {
      codigo: components['schemas']['CodigoDeProblema'];
      /** @description `seq` do lance com problema; null nos problemas do selo. */
      seq: number | null;
      mensagem: string;
    };
    /** @description Identificação do lote auditado, sem dado de usuário. */
    LoteDaAuditoria: {
      id: components['schemas']['Uuid'];
      titulo: string;
      cartaNome: string;
      status: components['schemas']['StatusLote'];
      inicioEm: components['schemas']['Instante'];
      fimEm: components['schemas']['Instante'];
      totalLances: number;
    };
    /**
     * @description Cadeia completa e veredito do servidor. `veredito` `integro` se e só se `problemas` está vazio.
     *     A gênese (`hashAnterior` do lance 1) é SHA-256 de `leilao-verzel:genesis:` + `lote.id`.
     */
    Auditoria: {
      lote: components['schemas']['LoteDaAuditoria'];
      lances: components['schemas']['LanceDaCadeia'][];
      selo: components['schemas']['SeloDoLote'] | null;
      /** @enum {string} */
      veredito: 'integro' | 'adulterado';
      problemas: components['schemas']['ProblemaDeIntegridade'][];
    };
    RespostaAuditoria: {
      /** @constant */
      sucesso: true;
      dados: components['schemas']['Auditoria'];
    };
    ChavePublica: {
      keyId: components['schemas']['KeyId'];
      /** @constant */
      algoritmo: 'Ed25519';
      /** @description 32 bytes da chave pública em base64url sem padding (43 caracteres). */
      chavePublica: string;
      ativaDesde: components['schemas']['Instante'];
    };
    RespostaChaves: {
      /** @constant */
      sucesso: true;
      dados: components['schemas']['ChavePublica'][];
    };
    Erro: {
      /** @constant */
      sucesso: false;
      erro: {
        /** @enum {string} */
        codigo:
          | 'DADOS_INVALIDOS'
          | 'NAO_AUTENTICADO'
          | 'CSRF_INVALIDO'
          | 'PAPEL_NAO_PERMITIDO'
          | 'NAO_ENCONTRADO'
          | 'MUITAS_TENTATIVAS'
          | 'CREDENCIAIS_INVALIDAS'
          | 'EMAIL_EM_USO'
          | 'SESSAO_EXPIRADA'
          | 'SALDO_INSUFICIENTE'
          | 'LANCE_ABAIXO_DO_MINIMO'
          | 'JA_ESTA_GANHANDO'
          | 'LOTE_NAO_INICIADO'
          | 'LOTE_ENCERRADO'
          | 'LEILOEIRO_NAO_PODE_LANCAR'
          | 'CATALOGO_INDISPONIVEL'
          | 'CATALOGO_OCUPADO'
          | 'INDISPONIVEL';
        mensagem: string;
        detalhes?: {
          [key: string]: unknown;
        };
      };
    };
  };
  responses: {
    /** @description Processo vivo (live) ou dependências respondendo (ready). */
    SaudeOk: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': {
          /** @constant */
          sucesso: true;
          dados: components['schemas']['EstadoDeSaude'];
        };
      };
    };
    /**
     * @description Qualquer erro não listado na rota, no envelope padrão (specs/001 §Erros): 4xx do framework
     *     com o próprio status e o código da tabela de specs/001 (400, 409, 413, 414, 415, 422 e
     *     demais → DADOS_INVALIDOS; 401 → NAO_AUTENTICADO; 403 → PAPEL_NAO_PERMITIDO; 404 e 405 →
     *     NAO_ENCONTRADO; 429 → MUITAS_TENTATIVAS, com `Retry-After`), 5xx do framework com o
     *     próprio status (por exemplo 503) e INDISPONIVEL, e 500 INDISPONIVEL para erro não tratado.
     */
    Erro: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'];
      };
    };
    /** @description Dependência fora ou não verificada (INDISPONIVEL), com mensagem fixa e sem `detalhes`. */
    ErroIndisponivel: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'INDISPONIVEL';
            detalhes?: never;
          };
        };
      };
    };
    /**
     * @description Corpo, parâmetro ou header fora do contrato, incluindo campo desconhecido e `Idempotency-Key`
     *     repetida com corpo diferente (DADOS_INVALIDOS).
     */
    ErroDadosInvalidos: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'DADOS_INVALIDOS';
          };
        };
      };
    };
    /**
     * @description Parâmetro ou corpo fora do contrato (DADOS_INVALIDOS), com `detalhes.campo` = nome do
     *     primeiro campo inválido (specs/006 §Criação, specs/005).
     */
    ErroDadosInvalidosComCampo: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'DADOS_INVALIDOS';
            detalhes: {
              campo: string;
            };
          };
        };
      };
    };
    /** @description Rota restrita a outro papel (PAPEL_NAO_PERMITIDO). */
    ErroPapelNaoPermitido: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'PAPEL_NAO_PERMITIDO';
          };
        };
      };
    };
    /** @description Recurso inexistente, ou id que não é UUID (NAO_ENCONTRADO). */
    ErroNaoEncontrado: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'NAO_ENCONTRADO';
          };
        };
      };
    };
    /**
     * @description Catálogo sem condição de chamar a Scryfall (specs/005): `CATALOGO_OCUPADO` (sem ficha do
     *     bucket em 1 s; `tenteNovamenteEm` 1) ou `CATALOGO_INDISPONIVEL` (circuito aberto, Redis fora
     *     ou falha do upstream). `detalhes.tenteNovamenteEm` (segundos inteiros ≥ 1) é igual ao
     *     header `Retry-After`.
     */
    ErroCatalogo: {
      headers: {
        'Retry-After': components['headers']['RetryAfter'];
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @enum {unknown} */
            codigo: 'CATALOGO_OCUPADO' | 'CATALOGO_INDISPONIVEL';
            detalhes: {
              tenteNovamenteEm: number;
            };
          };
        };
      };
    };
    /** @description Sem cookie `access_token` válido (NAO_AUTENTICADO). */
    ErroNaoAutenticado: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'NAO_AUTENTICADO';
          };
        };
      };
    };
    /** @description Header `X-CSRF-Token` ausente ou diferente do cookie `csrf_token` (CSRF_INVALIDO). */
    ErroCsrfInvalido: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'CSRF_INVALIDO';
          };
        };
      };
    };
    /** @description CSRF inválido (CSRF_INVALIDO) ou rota restrita a outro papel (PAPEL_NAO_PERMITIDO). */
    ErroCsrfOuPapel: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @enum {unknown} */
            codigo: 'CSRF_INVALIDO' | 'PAPEL_NAO_PERMITIDO';
          };
        };
      };
    };
    /** @description E-mail inexistente ou senha errada, com a mesma mensagem (CREDENCIAIS_INVALIDAS). */
    ErroCredenciaisInvalidas: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'CREDENCIAIS_INVALIDAS';
          };
        };
      };
    };
    /** @description E-mail já cadastrado, sem diferenciar maiúsculas (EMAIL_EM_USO). */
    ErroEmailEmUso: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'EMAIL_EM_USO';
          };
        };
      };
    };
    /** @description Refresh token ausente, expirado, revogado ou reutilizado (SESSAO_EXPIRADA). */
    ErroSessaoExpirada: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'SESSAO_EXPIRADA';
          };
        };
      };
    };
    /** @description Limite de tentativas excedido (MUITAS_TENTATIVAS). */
    ErroMuitasTentativas: {
      headers: {
        'Retry-After': components['headers']['RetryAfter'];
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @constant */
            codigo: 'MUITAS_TENTATIVAS';
          };
        };
      };
    };
    /**
     * @description CSRF inválido (CSRF_INVALIDO) ou papel `leiloeiro` dando lance (LEILOEIRO_NAO_PODE_LANCAR,
     *     specs/007; a rota de lance não usa PAPEL_NAO_PERMITIDO).
     */
    ErroCsrfOuLeiloeiro: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro: {
            /** @enum {unknown} */
            codigo: 'CSRF_INVALIDO' | 'LEILOEIRO_NAO_PODE_LANCAR';
          };
        };
      };
    };
    /**
     * @description Lance recusado ou corpo inválido (422), na ordem de specs/007 §Transação. `LANCE_ABAIXO_DO_MINIMO`
     *     leva `detalhes.minimoCentavos` e `SALDO_INSUFICIENTE` leva `detalhes.disponivelCentavos`;
     *     `DADOS_INVALIDOS` também cobre a `Idempotency-Key` ausente, que não é UUID, ou repetida com
     *     outro lote ou valor. `detalhes` só tem valores primitivos.
     */
    ErroLanceRecusado: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Erro'] & {
          erro:
            | {
                /** @enum {unknown} */
                codigo:
                  'DADOS_INVALIDOS' | 'LOTE_ENCERRADO' | 'LOTE_NAO_INICIADO' | 'JA_ESTA_GANHANDO';
              }
            | {
                /** @constant */
                codigo: 'LANCE_ABAIXO_DO_MINIMO';
                detalhes: {
                  minimoCentavos: components['schemas']['Centavos'];
                };
              }
            | {
                /** @constant */
                codigo: 'SALDO_INSUFICIENTE';
                detalhes: {
                  disponivelCentavos: components['schemas']['Centavos'];
                };
              };
        };
      };
    };
  };
  parameters: {
    /** @description UUID gerado pelo cliente por operação. */
    IdempotencyKey: string;
    Pagina: number;
    /** @description Página de 1 a 500; o teto evita OFFSET sem limite (specs/005 e specs/006). */
    PaginaLimitada: number;
  };
  requestBodies: never;
  headers: {
    /** @description `csrf_token=<aleatório>; Path=/; Max-Age=604800; SameSite=Lax; Secure` (Secure em produção; sem HttpOnly). */
    CookieCsrf: string;
    /**
     * @description Um Set-Cookie por cookie:
     *     - `access_token=<JWT>; Path=/; Max-Age=900; HttpOnly; SameSite=Lax; Secure` (Secure em produção);
     *     - `refresh_token=<opaco>; Path=/api/auth; Max-Age=604800; HttpOnly; SameSite=Lax; Secure` (Secure em produção);
     *     - `csrf_token=<aleatório>; Path=/; Max-Age=604800; SameSite=Lax; Secure` (Secure em produção; sem HttpOnly).
     */
    CookiesDeSessao: string;
    /**
     * @description Um Set-Cookie por cookie, com valor vazio, `Max-Age=0` e os mesmos Path, HttpOnly, SameSite e
     *     Secure da emissão: `access_token` (Path=/), `refresh_token` (Path=/api/auth) e `csrf_token` (Path=/).
     */
    CookiesExpirados: string;
    /** @description Segundos até a próxima tentativa ser aceita. */
    RetryAfter: number;
    /** @description Sempre `public, max-age=31536000, immutable` (specs/005). */
    CacheControlImagem: 'public, max-age=31536000, immutable';
    /** @description SHA-256 dos bytes da imagem, em hexadecimal minúsculo, entre aspas (specs/005). */
    ETagImagem: string;
    /** @description Sempre `no-store`: a resposta reflete o banco no momento da consulta (specs/007, specs/008). */
    CacheControlNoStore: 'no-store';
    /** @description Sempre `public, max-age=60` (specs/008 §Interfaces e contratos). */
    CacheControlChaves: 'public, max-age=60';
  };
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  healthLive: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: components['responses']['SaudeOk'];
      default: components['responses']['Erro'];
    };
  };
  healthReady: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: components['responses']['SaudeOk'];
      503: components['responses']['ErroIndisponivel'];
      default: components['responses']['Erro'];
    };
  };
  authCsrf: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Cookie `csrf_token` emitido. */
      204: {
        headers: {
          'Set-Cookie': components['headers']['CookieCsrf'];
          [name: string]: unknown;
        };
        content?: never;
      };
      default: components['responses']['Erro'];
    };
  };
  authCadastro: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CadastroEntrada'];
      };
    };
    responses: {
      /** @description Conta criada e sessão iniciada. */
      201: {
        headers: {
          'Set-Cookie': components['headers']['CookiesDeSessao'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaUsuarioLogado'];
        };
      };
      403: components['responses']['ErroCsrfInvalido'];
      409: components['responses']['ErroEmailEmUso'];
      422: components['responses']['ErroDadosInvalidos'];
      429: components['responses']['ErroMuitasTentativas'];
      default: components['responses']['Erro'];
    };
  };
  authLogin: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginEntrada'];
      };
    };
    responses: {
      /** @description Sessão iniciada. */
      200: {
        headers: {
          'Set-Cookie': components['headers']['CookiesDeSessao'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaUsuarioLogado'];
        };
      };
      401: components['responses']['ErroCredenciaisInvalidas'];
      403: components['responses']['ErroCsrfInvalido'];
      422: components['responses']['ErroDadosInvalidos'];
      429: components['responses']['ErroMuitasTentativas'];
      default: components['responses']['Erro'];
    };
  };
  authRefresh: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Cookies renovados. */
      204: {
        headers: {
          'Set-Cookie': components['headers']['CookiesDeSessao'];
          [name: string]: unknown;
        };
        content?: never;
      };
      401: components['responses']['ErroSessaoExpirada'];
      403: components['responses']['ErroCsrfInvalido'];
      default: components['responses']['Erro'];
    };
  };
  authLogout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Sessão encerrada; os cookies de sessão são expirados. */
      204: {
        headers: {
          'Set-Cookie': components['headers']['CookiesExpirados'];
          [name: string]: unknown;
        };
        content?: never;
      };
      403: components['responses']['ErroCsrfInvalido'];
      default: components['responses']['Erro'];
    };
  };
  authMe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Usuário autenticado. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @constant */
            sucesso: true;
            dados: components['schemas']['Usuario'];
          };
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      default: components['responses']['Erro'];
    };
  };
  carteiraSaldo: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Saldo atual (projeção `wallet_balances`). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @constant */
            sucesso: true;
            dados: components['schemas']['Saldo'];
          };
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      default: components['responses']['Erro'];
    };
  };
  carteiraDepositar: {
    parameters: {
      query?: never;
      header: {
        /** @description UUID gerado pelo cliente por operação. */
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['DepositoEntrada'];
      };
    };
    responses: {
      /** @description Repetição da mesma `Idempotency-Key` com o mesmo corpo; mesmo lançamento, saldo atual. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaDeposito'];
        };
      };
      /** @description Depósito lançado no ledger. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaDeposito'];
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      403: components['responses']['ErroCsrfOuPapel'];
      422: components['responses']['ErroDadosInvalidos'];
      default: components['responses']['Erro'];
    };
  };
  carteiraExtrato: {
    parameters: {
      query?: {
        pagina?: components['parameters']['Pagina'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Página do extrato. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @constant */
            sucesso: true;
            dados: components['schemas']['Lancamento'][];
            meta: components['schemas']['MetaPaginacao'];
          };
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      422: components['responses']['ErroDadosInvalidos'];
      default: components['responses']['Erro'];
    };
  };
  catalogoBuscarCartas: {
    parameters: {
      query: {
        /** @description Busca em texto, sem espaços nas pontas. */
        q: string;
        /** @description Página de 1 a 500; o teto evita OFFSET sem limite (specs/005 e specs/006). */
        pagina?: components['parameters']['PaginaLimitada'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Página de cartas. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @constant */
            sucesso: true;
            dados: components['schemas']['CartaDaBusca'][];
            meta: components['schemas']['MetaPaginacao'];
          };
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      403: components['responses']['ErroPapelNaoPermitido'];
      422: components['responses']['ErroDadosInvalidosComCampo'];
      503: components['responses']['ErroCatalogo'];
      default: components['responses']['Erro'];
    };
  };
  imagemDoSnapshot: {
    parameters: {
      query?: never;
      header?: {
        'If-None-Match'?: string;
      };
      path: {
        snapshotId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Imagem do snapshot. */
      200: {
        headers: {
          'Cache-Control': components['headers']['CacheControlImagem'];
          ETag: components['headers']['ETagImagem'];
          [name: string]: unknown;
        };
        content: {
          'image/jpeg': string;
          'image/png': string;
        };
      };
      /** @description O `If-None-Match` casa com o `ETag`; sem corpo. */
      304: {
        headers: {
          'Cache-Control': components['headers']['CacheControlImagem'];
          ETag: components['headers']['ETagImagem'];
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['ErroNaoEncontrado'];
      default: components['responses']['Erro'];
    };
  };
  lotesListar: {
    parameters: {
      query?: {
        status?: 'ao_vivo' | 'agendado' | 'encerrado';
        q?: string;
        precoMin?: number;
        /** @description Maior ou igual a `precoMin`; senão, 422 com `detalhes.campo` `precoMax`. */
        precoMax?: number;
        raridade?: components['schemas']['Raridade'];
        /**
         * @description `termina_antes` (`fim_em` crescente), `mais_recente` (`criado_em` decrescente) ou
         *     `maior_lance` (preço decrescente).
         */
        ordem?: 'termina_antes' | 'mais_recente' | 'maior_lance';
        /** @description Página de 1 a 500; o teto evita OFFSET sem limite (specs/005 e specs/006). */
        pagina?: components['parameters']['PaginaLimitada'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Página de lotes. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaListaDeLotes'];
        };
      };
      422: components['responses']['ErroDadosInvalidosComCampo'];
      default: components['responses']['Erro'];
    };
  };
  lotesDetalhar: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Lote com o snapshot da carta, sem a imagem. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @constant */
            sucesso: true;
            dados: components['schemas']['LoteDetalhe'];
          };
        };
      };
      404: components['responses']['ErroNaoEncontrado'];
      default: components['responses']['Erro'];
    };
  };
  lancesListarDoLote: {
    parameters: {
      query?: {
        /** @description Página de 1 a 500; o teto evita OFFSET sem limite (specs/005 e specs/006). */
        pagina?: components['parameters']['PaginaLimitada'];
      };
      header?: never;
      path: {
        id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Página de lances. */
      200: {
        headers: {
          'Cache-Control': components['headers']['CacheControlNoStore'];
          [name: string]: unknown;
        };
        content: {
          /**
           * @example {
           *       "sucesso": true,
           *       "dados": [
           *         {
           *           "seq": 2,
           *           "pseudonimo": "Licitante #b04e7d",
           *           "valorCentavos": 16500,
           *           "criadoEm": "2026-10-27T14:03:41.907Z"
           *         },
           *         {
           *           "seq": 1,
           *           "pseudonimo": "Licitante #3fa9c1",
           *           "valorCentavos": 15000,
           *           "criadoEm": "2026-10-27T14:03:07.120Z"
           *         }
           *       ],
           *       "meta": {
           *         "total": 2,
           *         "pagina": 1,
           *         "limite": 50
           *       }
           *     }
           */
          'application/json': components['schemas']['RespostaListaDeLances'];
        };
      };
      404: components['responses']['ErroNaoEncontrado'];
      422: components['responses']['ErroDadosInvalidosComCampo'];
      default: components['responses']['Erro'];
    };
  };
  lancesAceitar: {
    parameters: {
      query?: never;
      header: {
        /** @description UUID gerado pelo cliente por operação. */
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        /**
         * @example {
         *       "valorCentavos": 16500
         *     }
         */
        'application/json': components['schemas']['LanceEntrada'];
      };
    };
    responses: {
      /**
       * @description Repetição da mesma `Idempotency-Key` com o mesmo lote e o mesmo valor; o `lance` original e o
       *     `lote` de agora, sem lance, lançamento, evento nem extensão novos.
       */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaLance'];
        };
      };
      /** @description Lance aceito, gravado na cadeia e comprometido na carteira. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          /**
           * @example {
           *       "sucesso": true,
           *       "dados": {
           *         "lance": {
           *           "seq": 2,
           *           "pseudonimo": "Licitante #b04e7d",
           *           "valorCentavos": 16500,
           *           "criadoEm": "2026-10-27T14:03:41.907Z"
           *         },
           *         "lote": {
           *           "lanceAtualCentavos": 16500,
           *           "fimEm": "2026-10-27T14:30:00.000Z",
           *           "totalLances": 2
           *         }
           *       }
           *     }
           */
          'application/json': components['schemas']['RespostaLance'];
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      403: components['responses']['ErroCsrfOuLeiloeiro'];
      404: components['responses']['ErroNaoEncontrado'];
      422: components['responses']['ErroLanceRecusado'];
      429: components['responses']['ErroMuitasTentativas'];
      503: components['responses']['ErroIndisponivel'];
      default: components['responses']['Erro'];
    };
  };
  meLancesListar: {
    parameters: {
      query?: {
        /** @description Página de 1 a 500; o teto evita OFFSET sem limite (specs/005 e specs/006). */
        pagina?: components['parameters']['PaginaLimitada'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Página dos lotes com lance do usuário. */
      200: {
        headers: {
          'Cache-Control': components['headers']['CacheControlNoStore'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaMeusLances'];
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      403: components['responses']['ErroPapelNaoPermitido'];
      422: components['responses']['ErroDadosInvalidosComCampo'];
      default: components['responses']['Erro'];
    };
  };
  auditoriaDoLote: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Auditoria do lote. */
      200: {
        headers: {
          'Cache-Control': components['headers']['CacheControlNoStore'];
          [name: string]: unknown;
        };
        content: {
          /**
           * @example {
           *       "sucesso": true,
           *       "dados": {
           *         "lote": {
           *           "id": "0198f3c0-7b1a-7c00-8000-000000000001",
           *           "titulo": "Black Lotus",
           *           "cartaNome": "Black Lotus",
           *           "status": "ao_vivo",
           *           "inicioEm": "2026-10-27T14:00:00.000Z",
           *           "fimEm": "2026-10-27T14:30:00.000Z",
           *           "totalLances": 1
           *         },
           *         "lances": [
           *           {
           *             "seq": 1,
           *             "pseudonimo": "Licitante #3fa9c1",
           *             "valorCentavos": 15000,
           *             "criadoEm": "2026-10-27T14:03:07.120Z",
           *             "hashAnterior": "82842ba46c36a8e7ea4d91bab2695ec3281f83824f6b9c91af66cbaef0423585",
           *             "hash": "af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb",
           *             "assinatura": "MOumYMXLSRf1yq3BzD9MT4kPV0kMPUFw4cUEvbCd-u90psSijUKdOoE4nO9hy__a9mAzFP3ygg-RNp5DNRDyDQ",
           *             "keyId": "21fe31dfa154a261"
           *           }
           *         ],
           *         "selo": null,
           *         "veredito": "integro",
           *         "problemas": []
           *       }
           *     }
           */
          'application/json': components['schemas']['RespostaAuditoria'];
        };
      };
      404: components['responses']['ErroNaoEncontrado'];
      default: components['responses']['Erro'];
    };
  };
  auditoriaChaves: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Chaves públicas publicadas. */
      200: {
        headers: {
          'Cache-Control': components['headers']['CacheControlChaves'];
          [name: string]: unknown;
        };
        content: {
          /**
           * @example {
           *       "sucesso": true,
           *       "dados": [
           *         {
           *           "keyId": "21fe31dfa154a261",
           *           "algoritmo": "Ed25519",
           *           "chavePublica": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
           *           "ativaDesde": "2026-10-25T12:00:00.000Z"
           *         }
           *       ]
           *     }
           */
          'application/json': components['schemas']['RespostaChaves'];
        };
      };
      default: components['responses']['Erro'];
    };
  };
  painelListarLotes: {
    parameters: {
      query?: {
        /** @description Página de 1 a 500; o teto evita OFFSET sem limite (specs/005 e specs/006). */
        pagina?: components['parameters']['PaginaLimitada'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Página dos lotes do usuário. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RespostaListaDeLotes'];
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      403: components['responses']['ErroPapelNaoPermitido'];
      422: components['responses']['ErroDadosInvalidosComCampo'];
      default: components['responses']['Erro'];
    };
  };
  painelCriarLote: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoteEntrada'];
      };
    };
    responses: {
      /** @description Lote criado. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @constant */
            sucesso: true;
            dados: components['schemas']['Lote'];
          };
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      403: components['responses']['ErroCsrfOuPapel'];
      422: components['responses']['ErroDadosInvalidosComCampo'];
      503: components['responses']['ErroCatalogo'];
      default: components['responses']['Erro'];
    };
  };
  painelResumo: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Resumo do painel. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @constant */
            sucesso: true;
            dados: components['schemas']['ResumoDoPainel'];
          };
        };
      };
      401: components['responses']['ErroNaoAutenticado'];
      403: components['responses']['ErroPapelNaoPermitido'];
      default: components['responses']['Erro'];
    };
  };
}
