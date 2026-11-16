/**
 * Campo do CONTATO no fluxo de follow-up — a regra de condição "Campo do contato"
 * e o nó "Preencher campo" leem e gravam o mesmo alvo, escrito como texto:
 *   - `name`, `email`, `city`… → coluna fixa de `contacts`;
 *   - `cf:<chave>`              → `contacts.custom_fields[<chave>]`.
 *
 * Tudo aqui é PURO (sem I/O): o motor carrega a ficha do contato e o adaptador
 * grava. Telefone se lê mas não se grava — trocar o número pelo fluxo quebraria
 * a conversa que o próprio fluxo está tendo.
 */

export const CAMPOS_FIXOS_DO_CONTATO = [
  { alvo: "name", rotulo: "Nome", gravavel: true },
  { alvo: "email", rotulo: "E-mail", gravavel: true },
  { alvo: "phone_number", rotulo: "Telefone", gravavel: false },
  { alvo: "city", rotulo: "Cidade", gravavel: true },
  { alvo: "district", rotulo: "Bairro", gravavel: true },
  { alvo: "street", rotulo: "Rua", gravavel: true },
  { alvo: "number", rotulo: "Número", gravavel: true },
  { alvo: "complement", rotulo: "Complemento", gravavel: true },
  { alvo: "zip_code", rotulo: "CEP", gravavel: true },
] as const;

export type CampoFixoDoContato = (typeof CAMPOS_FIXOS_DO_CONTATO)[number]["alvo"];

export const COLUNAS_FIXAS_DO_CONTATO: readonly CampoFixoDoContato[] = CAMPOS_FIXOS_DO_CONTATO.map((c) => c.alvo);

const PREFIXO_PERSONALIZADO = "cf:";
const CHAVE_PERSONALIZADA = /^[a-z][a-z0-9_]*$/i;

export type AlvoDoCampo =
  | { tipo: "fixo"; coluna: CampoFixoDoContato }
  | { tipo: "personalizado"; chave: string };

/** `null` quando o texto não é um alvo conhecido (o publish recusa; o motor ignora). */
export function lerAlvo(alvo: string | undefined | null): AlvoDoCampo | null {
  const t = (alvo ?? "").trim();
  if (t.startsWith(PREFIXO_PERSONALIZADO)) {
    const chave = t.slice(PREFIXO_PERSONALIZADO.length);
    return CHAVE_PERSONALIZADA.test(chave) && chave.length <= 60 ? { tipo: "personalizado", chave } : null;
  }
  return (COLUNAS_FIXAS_DO_CONTATO as readonly string[]).includes(t)
    ? { tipo: "fixo", coluna: t as CampoFixoDoContato }
    : null;
}

export function alvoGravavel(alvo: string | undefined | null): boolean {
  const a = lerAlvo(alvo);
  if (!a) return false;
  if (a.tipo === "personalizado") return true;
  return CAMPOS_FIXOS_DO_CONTATO.some((c) => c.alvo === a.coluna && c.gravavel);
}

/** A ficha do contato que o motor carrega para as regras. */
export interface FichaDoContato {
  fixos: Partial<Record<CampoFixoDoContato, string | null>>;
  personalizados: Record<string, unknown>;
}

function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(comoTexto).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  return String(v).trim();
}

export function valorDoCampo(ficha: FichaDoContato | null | undefined, alvo: string | undefined | null): string {
  const a = lerAlvo(alvo);
  if (!a || !ficha) return "";
  return a.tipo === "fixo" ? comoTexto(ficha.fixos[a.coluna]) : comoTexto(ficha.personalizados[a.chave]);
}

export const OPS_DO_CAMPO_DO_CONTATO = ["eq", "neq", "contains", "preenchido", "vazio"] as const;
export type OpDoCampoDoContato = (typeof OPS_DO_CAMPO_DO_CONTATO)[number];

export function ehOpDoCampoDoContato(op: string): op is OpDoCampoDoContato {
  return (OPS_DO_CAMPO_DO_CONTATO as readonly string[]).includes(op);
}

/** Operadores que não usam valor — a tela esconde o campo e o publish não exige. */
export function opSemValor(op: string): boolean {
  return op === "preenchido" || op === "vazio";
}

/** Comparação sem diferença de maiúsculas/acentos nas pontas: quem digita "sao paulo" quer casar "São Paulo". */
function normal(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function avaliarCampoDoContato(
  ficha: FichaDoContato | null | undefined,
  alvo: string | undefined | null,
  op: string,
  valor: string | number,
): boolean {
  if (!lerAlvo(alvo)) return false;
  const atual = normal(valorDoCampo(ficha, alvo));
  const esperado = normal(String(valor ?? ""));
  switch (op) {
    case "preenchido":
      return atual !== "";
    case "vazio":
      return atual === "";
    case "eq":
      return atual === esperado;
    case "neq":
      // Campo vazio NÃO prova a negativa — a mesma régua do resto da condição.
      return atual !== "" && atual !== esperado;
    case "contains":
      return esperado !== "" && atual.includes(esperado);
    default:
      return false;
  }
}

/** Teto do que se grava num campo — o mesmo recorte da resposta salva pelo Casar resposta. */
export const MAX_VALOR_DO_CAMPO = 500;

/**
 * O que o nó "Preencher campo" grava, ou `null` se não há nada a gravar
 * (valor vazio, alvo inválido, ou já preenchido com "manter o que já tem").
 */
export function valorParaGravar(input: {
  config: { alvo: string; fonte: "fixo" | "ultima_resposta"; valor?: string; se_ja_tiver?: "sobrescrever" | "manter" };
  ficha: FichaDoContato | null | undefined;
  ultimaResposta: string | null | undefined;
  /** Troca `{nome}`, `{primeiro_nome}` e `{campo:chave}` no texto fixo. */
  nome?: string | null;
}): string | null {
  const { config, ficha } = input;
  if (!alvoGravavel(config.alvo)) return null;
  if ((config.se_ja_tiver ?? "sobrescrever") === "manter" && valorDoCampo(ficha, config.alvo) !== "") return null;
  const bruto =
    config.fonte === "ultima_resposta"
      ? (input.ultimaResposta ?? "")
      : preencherVariaveis(config.valor ?? "", ficha, input.nome ?? null);
  const v = bruto.trim().slice(0, MAX_VALOR_DO_CAMPO);
  return v === "" ? null : v;
}

function preencherVariaveis(texto: string, ficha: FichaDoContato | null | undefined, nome: string | null): string {
  const n = (nome ?? ficha?.fixos.name ?? "").trim();
  return texto
    .replace(/\{\s*primeiro_nome\s*\}/gi, n.split(/\s+/)[0] ?? "")
    .replace(/\{\s*nome\s*\}/gi, n)
    .replace(/\{\s*campo:([a-z0-9_:]+)\s*\}/gi, (_, alvo: string) => valorDoCampo(ficha, alvo));
}

/** O patch que o adaptador aplica em `contacts` — coluna fixa ou merge em `custom_fields`. */
export function patchDoContato(
  alvo: string,
  valor: string,
  customAtual: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const a = lerAlvo(alvo);
  if (!a || !alvoGravavel(alvo)) return null;
  if (a.tipo === "fixo") return { [a.coluna]: valor };
  const prev = customAtual && typeof customAtual === "object" && !Array.isArray(customAtual) ? customAtual : {};
  return { custom_fields: { ...prev, [a.chave]: valor } };
}
