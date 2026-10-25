// Leitura dos segredos pela API (specs/014 §"Leitura pela API, pelo runner de migrations e pelo
// seed", ADR 0023): para cada segredo, exatamente uma de <VAR> (o valor; dev e CI) ou <VAR>_FILE
// (caminho absoluto do arquivo com o valor; produção). Nenhuma mensagem cita valor, conteúdo do
// arquivo nem caminho: só o nome da variável.
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/** Forma canônica dos 5 segredos: 43 caracteres base64url, sem padding, que decodificam para 32 bytes. */
const FORMA_DO_SEGREDO = /^[A-Za-z0-9_-]{43}$/;
const BYTES_DO_SEGREDO = 32;

/**
 * Teto de leitura do arquivo. O valor tem 43 bytes; o teto só evita carregar na memória um
 * arquivo enorme apontado por engano (o conteúdo é recusado de qualquer forma).
 */
const TAMANHO_MAXIMO_DO_ARQUIVO = 4_096;

/**
 * Valor na forma canônica de specs/014 §Leitura: 43 caracteres A–Z a–z 0–9 - _, 32 bytes
 * decodificados, e recodificar esses bytes reproduz exatamente o texto (recusa, por exemplo, um
 * último caractere com bits extras). Quebra de linha no fim também é recusada.
 */
export function ehSegredoCanonico(valor: string): boolean {
  if (!FORMA_DO_SEGREDO.test(valor)) {
    return false;
  }
  const bytes = Buffer.from(valor, 'base64url');
  return bytes.length === BYTES_DO_SEGREDO && bytes.toString('base64url') === valor;
}

export type SegredoResolvido =
  | { readonly ok: true; readonly valor: string; readonly variavel: string }
  | { readonly ok: false; readonly problema: string };

/** Conteúdo do arquivo, só se for regular, legível e pequeno; qualquer falha vira undefined. */
function lerArquivoDoSegredo(caminho: string): string | undefined {
  try {
    const info = statSync(caminho);
    if (!info.isFile() || info.size > TAMANHO_MAXIMO_DO_ARQUIVO) {
      return undefined;
    }
    return readFileSync(caminho, 'utf8');
  } catch {
    // ENOENT, EACCES, EISDIR...: o motivo exato não vai à mensagem (citaria o caminho).
    return undefined;
  }
}

/**
 * De onde vem o segredo `nome`: de `nome` ou do arquivo de `nome_FILE`. Não confere a forma
 * canônica (isso é do esquema do env, que cita a variável de origem devolvida aqui). Uma variável
 * definida com texto vazio conta como definida.
 */
export function resolverSegredo(
  origem: Readonly<Record<string, string | undefined>>,
  nome: string,
): SegredoResolvido {
  const variavelDoArquivo = `${nome}_FILE`;
  const valor = origem[nome];
  const caminho = origem[variavelDoArquivo];

  if (valor !== undefined && caminho !== undefined) {
    return { ok: false, problema: `${nome} e ${variavelDoArquivo} (defina só uma das duas)` };
  }
  if (valor !== undefined) {
    return { ok: true, valor, variavel: nome };
  }
  if (caminho === undefined) {
    return { ok: false, problema: `${nome} ou ${variavelDoArquivo} (ausente)` };
  }
  if (!isAbsolute(caminho)) {
    return { ok: false, problema: `${variavelDoArquivo} (o caminho precisa ser absoluto)` };
  }
  const conteudo = lerArquivoDoSegredo(caminho);
  if (conteudo === undefined) {
    return {
      ok: false,
      problema: `${variavelDoArquivo} (arquivo ausente, ilegível ou que não é um arquivo regular)`,
    };
  }
  return { ok: true, valor: conteudo, variavel: variavelDoArquivo };
}
