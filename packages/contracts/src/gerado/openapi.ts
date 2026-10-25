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
  };
  parameters: {
    /** @description UUID gerado pelo cliente por operação. */
    IdempotencyKey: string;
    Pagina: number;
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
}
