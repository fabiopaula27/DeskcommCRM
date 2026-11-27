/**
 * Resumo da IA do lead: junta tudo o que se sabe do contato num texto curto
 * para o vendedor. `montarContextoDoLead` é puro (testado); a rota faz o I/O e
 * chama o modelo pelo ponto `draft_suggestion` (ajudante do atendente).
 */
export const LIMITE_DO_CONTEXTO = 12_000;

export type DadosDoLead = {
  fuso: string;
  contato: { nome: string | null; telefone: string | null; email: string | null; origem: string | null; criadoEm: string; tags: string[]; campos: Record<string, unknown> };
  anotacoes: { criadaEm: string; autor: string | null; texto: string | null; kind: "text" | "audio" }[];
  tarefas: { titulo: string; status: string; prazo: string | null; descricao: string | null }[];
  negocios: { titulo: string; etapa: string | null; status: string; valorCents: number | null }[];
  agendamentos: { titulo: string; inicio: string; status: string }[];
  mensagens: { em: string; deQuem: "lead" | "empresa"; texto: string }[];
};

function quando(iso: string, fuso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function campoLegivel(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(String).join(", ");
  return null;
}

/**
 * Seções em ordem de valor: ficha, anotações, tarefas, negócios, agenda — e as
 * mensagens por último, porque são as primeiras a sair quando passa do limite.
 */
export function montarContextoDoLead(d: DadosDoLead): string {
  const c = d.contato;
  const ficha = [
    `Nome: ${c.nome ?? "(sem nome)"}`,
    c.telefone ? `Telefone: ${c.telefone}` : null,
    c.email ? `E-mail: ${c.email}` : null,
    c.origem ? `Origem: ${c.origem}` : null,
    `Cliente desde: ${quando(c.criadoEm, d.fuso)}`,
    c.tags.length ? `Etiquetas: ${c.tags.join(", ")}` : null,
    ...Object.entries(c.campos)
      .map(([k, v]) => {
        const t = campoLegivel(v);
        return t ? `${k}: ${t}` : null;
      })
      .filter(Boolean),
  ].filter(Boolean);

  const blocos: string[] = [`## Ficha\n${ficha.join("\n")}`];
  blocos.push(
    `## Anotações da equipe (${d.anotacoes.length})\n` +
      (d.anotacoes.length
        ? d.anotacoes
            .map((a) => `- ${quando(a.criadaEm, d.fuso)}${a.autor ? ` · ${a.autor}` : ""}${a.kind === "audio" ? " · áudio" : ""}: ${a.texto ?? "(áudio sem transcrição)"}`)
            .join("\n")
        : "- nenhuma"),
  );
  blocos.push(
    `## Tarefas (${d.tarefas.length})\n` +
      (d.tarefas.length
        ? d.tarefas
            .map((t) => `- [${t.status}] ${t.titulo}${t.prazo ? ` · prazo ${quando(t.prazo, d.fuso)}` : ""}${t.descricao ? ` — ${t.descricao}` : ""}`)
            .join("\n")
        : "- nenhuma"),
  );
  blocos.push(
    `## Negócios no funil (${d.negocios.length})\n` +
      (d.negocios.length
        ? d.negocios
            .map((n) => `- ${n.titulo} · etapa ${n.etapa ?? "?"} · ${n.status}${n.valorCents ? ` · R$ ${(n.valorCents / 100).toFixed(2)}` : ""}`)
            .join("\n")
        : "- nenhum"),
  );
  blocos.push(
    `## Agendamentos (${d.agendamentos.length})\n` +
      (d.agendamentos.length
        ? d.agendamentos.map((a) => `- ${quando(a.inicio, d.fuso)} · ${a.titulo} · ${a.status}`).join("\n")
        : "- nenhum"),
  );

  let texto = blocos.join("\n\n");
  if (texto.length >= LIMITE_DO_CONTEXTO) return texto.slice(0, LIMITE_DO_CONTEXTO);

  const cabecalho = `\n\n## Últimas mensagens da conversa (mais antigas primeiro)\n`;
  const sobra = LIMITE_DO_CONTEXTO - texto.length - cabecalho.length;
  const linhas: string[] = [];
  let usado = 0;
  // Das mais novas para as mais antigas, até caber; depois volta à ordem do tempo.
  for (const m of [...d.mensagens].reverse()) {
    const l = `- ${quando(m.em, d.fuso)} · ${m.deQuem === "lead" ? "Lead" : "Empresa"}: ${m.texto.replace(/\s+/g, " ").slice(0, 500)}`;
    if (usado + l.length + 1 > sobra) break;
    linhas.unshift(l);
    usado += l.length + 1;
  }
  texto += cabecalho + (linhas.length ? linhas.join("\n") : "- nenhuma");
  return texto;
}

export const INSTRUCOES_DO_RESUMO = `Você ajuda um vendedor a lembrar tudo sobre um lead antes de falar com ele.
Com base SOMENTE nos dados abaixo, escreva em português do Brasil, curto e direto, com estes títulos:
**Quem é** · **O que quer** · **O que já foi combinado** · **Pendências** · **Próximo passo sugerido**
Regras: não invente nada; se faltar informação para um título, escreva "Sem informação ainda." Cite datas quando ajudarem. Não use mais de 180 palavras.`;

export function haPoucaInformacao(d: DadosDoLead): boolean {
  return d.anotacoes.length === 0 && d.tarefas.length === 0 && d.negocios.length === 0 && d.agendamentos.length === 0 && d.mensagens.length === 0;
}

export const RESUMO_SEM_DADOS =
  "Ainda há pouca informação sobre este lead: nenhuma anotação, tarefa, negócio, agendamento ou mensagem. Registre uma anotação para o resumo ter o que contar.";
