import type { SheetMatrix } from "@/lib/planilha/ler-arquivo";
import type {
  CandidatoNaPlanilha,
  LinhaExcluida,
  MotivoDeExclusao,
} from "@/lib/prospecting/importacao-previa";
import { TEXTO_DO_MOTIVO } from "@/lib/prospecting/importacao-previa";
import { normalizeProspectPhone, safePublicLink } from "@/lib/prospecting/schema";

/**
 * A PLANILHA DE PROSPECÇÃO — a lista própria do operador como segunda porta de entrada
 * dos candidatos (a primeira é a busca no Google Maps).
 *
 * Este arquivo só LÊ e valida: devolve candidatos no mesmo formato `Prospect` que a busca
 * produz, para que a gravação, a triagem, a auditoria de site e a fila sejam o caminho que
 * já existe. Recusar é a função: linha sem nome ou sem telefone válido volta ao operador
 * com o número da linha e o motivo, nunca vira chute.
 */

/** Dez dias de fila no teto de 50 por dia; a tela de candidatos já lista até 5.000. */
export const PLANILHA_MAX_LINHAS = 500;

type Campo = "name" | "phone" | "website" | "category" | "address" | "emails" | "socials" | "tags";

/**
 * Para onde vai uma coluna da planilha: um campo fixo do contato, um campo personalizado
 * do contato (`cf:<key>`, definido em Etapas do funil com escopo Contato) ou lugar nenhum.
 */
export type DestinoDaColuna = Campo | `cf:${string}` | "ignorar";

/** Os campos fixos, na ordem e com o rótulo que a tela mostra. */
export const CAMPOS_FIXOS_DA_PLANILHA: readonly { destino: Campo; rotulo: string }[] = [
  { destino: "name", rotulo: "Nome" },
  { destino: "phone", rotulo: "Telefone" },
  { destino: "emails", rotulo: "E-mail" },
  { destino: "website", rotulo: "Site" },
  { destino: "category", rotulo: "Categoria" },
  { destino: "address", rotulo: "Endereço" },
  { destino: "socials", rotulo: "Redes sociais" },
  { destino: "tags", rotulo: "Tags" },
];

/** O mínimo de um campo personalizado que a leitura precisa. */
export interface CampoPersonalizadoDaPlanilha {
  key: string;
  label: string;
}

/** Uma coluna como a tela de relacionar mostra: título, um exemplo e o destino em vigor. */
export interface ColunaDaPlanilha {
  titulo: string;
  exemplo: string;
  destino: DestinoDaColuna;
}

/** Formas aceitas de cada coluna, sem acento e sem caixa (inclui espanhol). */
const COLUNAS: Record<Campo, readonly string[]> = {
  name: ["empresa", "nome", "nome fantasia", "razao social", "negocio", "nombre"],
  phone: ["telefone", "celular", "whatsapp", "fone", "phone", "telefono", "movil"],
  website: ["site", "website", "url", "pagina", "sitio web"],
  category: ["segmento", "categoria", "ramo", "nicho", "rubro"],
  address: ["endereco", "cidade", "local", "direccion"],
  emails: ["email", "e-mail", "correo"],
  socials: ["instagram", "facebook", "linkedin", "redes"],
  tags: ["tags", "tag", "etiquetas", "etiqueta"],
};

/** Campos que aceitam mais de uma coluna (nos demais vale só a primeira). */
const MULTIPLAS: ReadonlySet<Campo> = new Set<Campo>(["address", "emails", "socials", "tags"]);

function normalizarCabecalho(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function campoDaColuna(cabecalho: string): Campo | null {
  const alvo = normalizarCabecalho(cabecalho);
  for (const [campo, formas] of Object.entries(COLUNAS) as [Campo, readonly string[]][]) {
    if (formas.includes(alvo)) return campo;
  }
  return null;
}

/**
 * O site como a pessoa digita na planilha: quase sempre sem protocolo ("www.padaria.com.br").
 * Sem protocolo ganha `https://`; o que não vira URL `http(s)` (um `javascript:`, um texto
 * solto) fica nulo em vez de ser gravado — o mesmo `safePublicLink` que guarda as redes.
 */
function siteDaCelula(bruto: string): string | null {
  if (!bruto) return null;
  const comProtocolo = /^[a-z][a-z0-9+.-]*:/i.test(bruto) ? bruto : `https://${bruto}`;
  const url = safePublicLink(comProtocolo);
  return url && url.length <= 500 ? url : null;
}

export type LeituraDaPlanilhaDeProspeccao =
  | {
      candidatos: CandidatoNaPlanilha[];
      erros: LinhaExcluida[];
      colunasIgnoradas: string[];
      colunas: ColunaDaPlanilha[];
    }
  | { erro: string; colunas?: ColunaDaPlanilha[] };

/**
 * O destino que a leitura sugere para um título: campo fixo pelos nomes aceitos; senão,
 * campo personalizado cujo rótulo ou chave bata com o título (sem acento e sem caixa).
 */
export function sugerirDestino(
  titulo: string,
  personalizados: readonly CampoPersonalizadoDaPlanilha[] = [],
): DestinoDaColuna {
  const fixo = campoDaColuna(titulo);
  if (fixo) return fixo;
  const alvo = normalizarCabecalho(titulo);
  if (!alvo) return "ignorar";
  const achado = personalizados.find(
    (c) =>
      normalizarCabecalho(c.label) === alvo ||
      normalizarCabecalho(c.key) === alvo.replace(/ /g, "_"),
  );
  return achado ? `cf:${achado.key}` : "ignorar";
}

export interface OpcoesDaLeitura {
  /** O destino de cada coluna, pela posição. Ausente = sugestão automática. */
  mapa?: readonly string[] | null;
  /** Os campos personalizados do contato que a organização tem. */
  personalizados?: readonly CampoPersonalizadoDaPlanilha[];
}

export function lerPlanilhaDeProspeccao(
  sheet: SheetMatrix,
  opcoes: OpcoesDaLeitura = {},
): LeituraDaPlanilhaDeProspeccao {
  if (sheet.rows.length > PLANILHA_MAX_LINHAS) {
    // Importar "os primeiros 500" em silêncio deixaria o operador achar que a lista inteira entrou.
    return { erro: `Máximo de ${PLANILHA_MAX_LINHAS} linhas de dados.` };
  }
  const personalizados = opcoes.personalizados ?? [];
  const chavesValidas = new Set(personalizados.map((c) => c.key));
  const fixosValidos = new Set<string>(CAMPOS_FIXOS_DA_PLANILHA.map((c) => c.destino));
  const destinoValido = (d: string | undefined): DestinoDaColuna | null => {
    if (!d) return null;
    if (d === "ignorar" || fixosValidos.has(d)) return d as DestinoDaColuna;
    if (d.startsWith("cf:") && chavesValidas.has(d.slice(3))) return d as DestinoDaColuna;
    return null;
  };

  const primeiraLinha = sheet.rows.find((r) => r.some((c) => c.trim() !== "")) ?? [];
  const mapa = opcoes.mapa ?? null;
  const colunasDaTela: ColunaDaPlanilha[] = sheet.headers.map((titulo, i) => ({
    titulo: titulo.trim(),
    exemplo: (primeiraLinha[i] ?? "").trim().slice(0, 80),
    destino: mapa ? (destinoValido(mapa[i]) ?? "ignorar") : sugerirDestino(titulo, personalizados),
  }));

  const colunas = new Map<Campo, number[]>();
  const personalizadasNaPlanilha = new Map<string, number>();
  const colunasIgnoradas: string[] = [];
  colunasDaTela.forEach(({ titulo, destino }, i) => {
    if (destino.startsWith("cf:")) {
      const chave = destino.slice(3);
      if (!personalizadasNaPlanilha.has(chave)) personalizadasNaPlanilha.set(chave, i);
      return;
    }
    const campo = destino === "ignorar" ? null : (destino as Campo);
    if (campo && (MULTIPLAS.has(campo) || !colunas.has(campo))) {
      colunas.set(campo, [...(colunas.get(campo) ?? []), i]);
    } else if (titulo !== "") {
      colunasIgnoradas.push(titulo);
    }
  });

  if (mapa && (!colunas.has("name") || !colunas.has("phone"))) {
    return {
      erro: 'Relacione uma coluna a "Nome" e outra a "Telefone" para importar.',
      colunas: colunasDaTela,
    };
  }
  if (!colunas.has("name") || !colunas.has("phone")) {
    const encontradas = sheet.headers.map((h) => h.trim()).filter(Boolean);
    return {
      erro:
        "A planilha precisa de uma coluna com o nome da empresa e outra com o telefone. " +
        `Encontrei: ${encontradas.join(", ") || "nenhuma coluna"}. ` +
        `Nomes aceitos para a empresa: ${COLUNAS.name.join(", ")}. ` +
        `Nomes aceitos para o telefone: ${COLUNAS.phone.join(", ")}.`,
      colunas: colunasDaTela,
    };
  }

  const valores = (linha: string[], campo: Campo): string[] =>
    (colunas.get(campo) ?? []).map((i) => (linha[i] ?? "").trim()).filter(Boolean);
  const primeiro = (linha: string[], campo: Campo) => valores(linha, campo)[0] ?? "";

  const candidatos: CandidatoNaPlanilha[] = [];
  const erros: LinhaExcluida[] = [];
  const telefonesVistos = new Map<string, number>();

  sheet.rows.forEach((bruto, i) => {
    const linha = i + 2;
    if (bruto.every((c) => c.trim() === "")) return;

    const name = primeiro(bruto, "name").replace(/\s+/g, " ").slice(0, 200);
    if (name.length < 2) {
      erros.push({ linha, telefone: null, codigo: "sem_nome", motivo: TEXTO_DO_MOTIVO.sem_nome });
      return;
    }

    // Telefone EM BRANCO e telefone preenchido que não vira E.164 são dois problemas
    // diferentes: o primeiro é a linha incompleta, o segundo é o número digitado errado
    // (ou um "11 9999" sem o nono). O operador conserta um e o outro de formas distintas.
    const brutoTelefone = primeiro(bruto, "phone");
    const phone = normalizeProspectPhone(brutoTelefone);
    if (!phone) {
      const codigo: MotivoDeExclusao = brutoTelefone ? "telefone_invalido" : "sem_telefone";
      erros.push({ linha, telefone: null, codigo, motivo: TEXTO_DO_MOTIVO[codigo] });
      return;
    }
    const jaVisto = telefonesVistos.get(phone);
    if (jaVisto !== undefined) {
      erros.push({
        linha,
        telefone: phone,
        codigo: "repetido_na_planilha",
        motivo: TEXTO_DO_MOTIVO.repetido_na_planilha,
        detalhe: `linha ${jaVisto}`,
      });
      return;
    }
    telefonesVistos.set(phone, linha);

    const emails = [
      ...new Set(
        valores(bruto, "emails")
          .flatMap((v) => v.split(/[,;\s]+/))
          .filter((e) => e.includes("@"))
          .map((e) => e.slice(0, 500)),
      ),
    ].slice(0, 5);
    const socials = [
      ...new Set(
        valores(bruto, "socials")
          .flatMap((v) => v.split(/[,;\s]+/))
          .map((v) => safePublicLink(v))
          .filter((v): v is string => !!v && v.length < 500),
      ),
    ].slice(0, 15);
    const tags = [
      ...new Set(
        valores(bruto, "tags")
          .flatMap((v) => v.split(/[,;]+/))
          .map((v) => v.trim().slice(0, 60))
          .filter(Boolean),
      ),
    ].slice(0, 20);

    candidatos.push({
      linha,
      prospect: {
        // Estável: reimportar o mesmo número bate no `unique` e no gatilho de supressão da LGPD.
        key: `planilha:${phone}`,
        name,
        phone,
        website: siteDaCelula(primeiro(bruto, "website")),
        category: primeiro(bruto, "category").slice(0, 500) || null,
        address: valores(bruto, "address").join(", ").slice(0, 500) || null,
        maps_url: null,
        rating: null,
        reviews: null,
        emails,
        socials,
        ...(tags.length > 0 ? { tags } : {}),
        ...camposPersonalizadosDaLinha(bruto, personalizadasNaPlanilha),
      },
    });
  });

  return { candidatos, erros, colunasIgnoradas, colunas: colunasDaTela };
}

/** Os valores dos campos personalizados de uma linha; nada quando todos vêm vazios. */
function camposPersonalizadosDaLinha(
  linha: string[],
  colunas: ReadonlyMap<string, number>,
): { custom_fields?: Record<string, string> } {
  const campos: Record<string, string> = {};
  for (const [chave, i] of colunas) {
    const valor = (linha[i] ?? "").trim().slice(0, 1000);
    if (valor) campos[chave] = valor;
  }
  return Object.keys(campos).length > 0 ? { custom_fields: campos } : {};
}
