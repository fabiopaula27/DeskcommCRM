# Relatórios — Parte 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/app/relatorios` (menu Análise) com cabeçalho de período, abas e as abas Atendimento, Leads & Vendas e Funil com dados reais, e PDF por impressão do navegador.

**Architecture:** Cada aba tem uma rota `GET /api/v1/reports/<aba>` (piso `manager`) que chama UMA função SQL agregadora (`fn_relatorio_<aba>`) e devolve JSON pronto para os gráficos. Lógica pura (preencher dias vazios, variação vs ontem, ranking) fica em `lib/relatorios/*.ts`, testada sem banco. A página é server component que confere o papel e renderiza um client com abas; cada aba busca a própria rota com React Query.

**Tech Stack:** Next.js App Router, Supabase (RPC), zod, @tanstack/react-query, recharts, vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-relatorios-design.md`

## Global Constraints

- Piso de papel: `manager` nas rotas e na página (`requireRole("manager", …)`; página faz `notFound()`/aviso abaixo disso).
- Organização SEMPRE da org ativa (`authz.org.orgId`), nunca de query/body.
- Fuso = `organizations.timezone` via `fusoUtilizavel` (`lib/tempo/fusos`); período inclui o dia final inteiro.
- Período padrão: dia 1 do mês corrente até hoje. Máximo 366 dias (422 acima disso).
- Números que existem em Métricas usam o mesmo critério: venda = `crm_leads.status = 'won'` com `closed_at` no período; receita = soma de `value_cents`; mensagem de IA = `messages.sent_via = 'ai'`; humana = `sent_via in ('user','crm','external_device')`; recebida = `direction = 'inbound'`.
- Funções SQL novas: `security invoker`, `set search_path = ''`, `grant execute … to authenticated`, idempotentes (`create or replace`). Migration única `supabase/migrations/20261126130000_9111_relatorios_parte_1.sql`.
- Rota sem a função no banco (erro `PGRST202`/`42883`) responde 200 com `{ disponivel: false, motivo: "aplique a migration 9111" }`; a aba mostra esse aviso, nunca quebra.
- Texto da tela em português, sentence case, via `t()`; sem nome de tabela/coluna na UI.
- Design: tokens e componentes existentes (`components/ui`), um número em destaque por bloco, estados vazios que dizem o que fazer. Seguir `frontend-design` sem fugir do sistema visual do CRM.

## Review Focus

- Período com dias sem nenhum dado → séries têm um ponto 0 por dia (sem buracos no gráfico). Teste em Task 2.
- "Ontem" = 0 e "hoje" > 0 → variação mostra "novo", nunca `Infinity`/`NaN`. Teste em Task 2.
- `from` depois de `to`, ou datas inválidas → 422 com mensagem. Teste em Task 3.
- Papel `agent` chamando a rota → 403. Teste em Task 3.
- Migration 9111 ainda não aplicada → aba mostra aviso, não erro. Teste em Task 3.

---

### Task 1: Funções SQL agregadoras

**Files:**
- Create: `supabase/migrations/20261126130000_9111_relatorios_parte_1.sql`

**Interfaces:**
- Produces:
  - `fn_relatorio_atendimento(p_org uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_user uuid default null) returns jsonb` com chaves: `hoje {conversas, leads, vendas, receita_cents}`, `ontem {…mesmas}`, `trinta_dias {…mesmas}`, `conversas_por_dia [{dia date, total int}]`, `conversas_resumo {total, ativas, pausadas, tempo_medio_atendimento_s, tempo_primeira_resposta_s}`, `por_canal [{canal text, total int}]`, `mensagens {enviadas, humanas, ia, recebidas, media_por_conversa}`, `humanas_por_hora [{hora int, total int}]`, `ia_por_hora [...]`, `ia_por_dia [{dia, total}]`, `atendentes [{user_id, nome, email, conversas, mensagens, leads, vendas}]`.
  - `fn_relatorio_leads(p_org uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_owner uuid default null) returns jsonb`: `leads_por_dia [{dia,total}]`, `leads_total`, `convertidos`, `origens [{origem,total}]`, `vendas_por_dia [{dia,total,receita_cents}]`, `vendas_total`, `receita_cents`, `vendedores [{user_id,nome,email,leads,vendas,receita_cents}]`.
  - `fn_relatorio_funil(p_org uuid, p_from timestamptz, p_to timestamptz, p_pipeline uuid default null) returns jsonb`: `funis [{pipeline_id,nome,posicao,leads,valor_cents}]`, `etapas [{pipeline_id,stage_id,nome,posicao,leads}]`.

- [ ] **Step 1:** Escrever as três funções. "Hoje/ontem" calculados no fuso `p_tz` a partir de `now()`; `trinta_dias` = últimos 30 dias até agora. Dias agrupados com `(x at time zone p_tz)::date`. Pausadas = `conversations.status` de pausa/snooze conforme o check da tabela; ativas = abertas. Tempo de 1ª resposta = mediana (`percentile_cont(0.5)`) entre 1ª inbound e 1ª outbound humana da conversa no período. Distribuição por fila: verificar `supabase/migrations/20261020130000_0692_rodizio_na_acao_atribuir.sql`; se houver registro de atribuições, incluir `distribuicoes [{user_id,nome,total}]`, senão omitir a chave.
- [ ] **Step 2:** Rodar o SQL num banco local/staging (ou colar no Studio) e conferir `select public.fn_relatorio_atendimento('<org>', now()-interval '30 days', now(), 'America/Sao_Paulo')` devolve JSON com todas as chaves.
- [ ] **Step 3:** Commit `feat(relatorios): funções SQL da parte 1`.

### Task 2: Lógica pura dos relatórios

**Files:**
- Create: `lib/relatorios/periodo.ts`, `lib/relatorios/series.ts`
- Test: `lib/relatorios/periodo.test.ts`, `lib/relatorios/series.test.ts`

**Interfaces:**
- Produces:
  - `periodoPadrao(agora: Date, tz: string): { from: string; to: string }` (ISO, dia 1 do mês 00:00 no fuso até fim de hoje).
  - `validarPeriodo(from?: string, to?: string, agora: Date, tz: string): { ok: true; from: Date; to: Date } | { ok: false; mensagem: string }` (recusa `from > to` e > 366 dias).
  - `preencherDias<T extends { dia: string }>(serie: T[], from: Date, to: Date, tz: string, vazio: (dia: string) => T): T[]`.
  - `variacao(hoje: number, ontem: number): { tipo: "novo" | "igual" | "pct"; pct?: number }`.
  - `preencherHoras(serie: { hora: number; total: number }[]): { hora: number; total: number }[]` (24 itens).

- [ ] **Step 1: Testes**
```ts
it("preenche dias vazios com zero", () => {
  const r = preencherDias([{ dia: "2026-11-03", total: 5 }], new Date("2026-11-01T03:00:00Z"), new Date("2026-11-04T02:59:59Z"), "America/Sao_Paulo", (dia) => ({ dia, total: 0 }));
  expect(r.map((x) => x.total)).toEqual([0, 0, 5]);
});
it("variacao com ontem zero é 'novo'", () => expect(variacao(3, 0)).toEqual({ tipo: "novo" }));
it("variacao -61.1%", () => expect(variacao(7, 18)).toEqual({ tipo: "pct", pct: -61.1 }));
it("variacao igual", () => expect(variacao(0, 0)).toEqual({ tipo: "igual" }));
it("recusa from depois de to", () => expect(validarPeriodo("2026-11-10T00:00:00Z", "2026-11-01T00:00:00Z", new Date(), "UTC").ok).toBe(false));
it("recusa mais de 366 dias", () => expect(validarPeriodo("2025-01-01T00:00:00Z", "2026-11-01T00:00:00Z", new Date(), "UTC").ok).toBe(false));
it("24 horas sempre", () => expect(preencherHoras([{ hora: 10, total: 4 }])).toHaveLength(24));
```
- [ ] **Step 2:** `npx vitest run lib/relatorios` → FAIL (não definido).
- [ ] **Step 3:** Implementar. `pct` arredondado a 1 casa.
- [ ] **Step 4:** `npx vitest run lib/relatorios` → PASS.
- [ ] **Step 5:** Commit `feat(relatorios): período, séries e variação`.

### Task 3: Rotas da API

**Files:**
- Create: `app/api/v1/reports/atendimento/route.ts`, `app/api/v1/reports/leads/route.ts`, `app/api/v1/reports/funil/route.ts`, `app/api/v1/reports/_comum.ts`
- Test: `app/api/v1/reports/atendimento/route.test.ts`

**Interfaces:**
- Consumes: Task 1 RPCs, Task 2 funções.
- Produces: `GET /api/v1/reports/atendimento?from&to&user_id` → `{ data: { disponivel: true, periodo, ...payload com séries preenchidas e variacao por cartão } | { disponivel: false, motivo } }`; idem `leads?from&to&owner_id`, `funil?from&to&pipeline_id`.
- `_comum.ts`: `lerContexto(req, requestId): Promise<{ ok: true; supabase; orgId; tz; from: Date; to: Date } | { ok: false; response: Response }>` (role manager + fuso + `validarPeriodo`), `funcaoAusente(error): boolean` (`PGRST202` ou `42883`).

- [ ] **Step 1: Testes** (mock de `requireRole` e `createClient`, padrão de `app/api/v1/metrics/funil/route.test.ts`): 403 quando `requireRole` nega; 422 com `from > to`; `disponivel:false` quando RPC devolve `{ code: "PGRST202" }`; 200 com `conversas_por_dia` contendo um item por dia do período.
- [ ] **Step 2:** `npx vitest run app/api/v1/reports` → FAIL.
- [ ] **Step 3:** Implementar as três rotas sobre `_comum.ts`.
- [ ] **Step 4:** `npx vitest run app/api/v1/reports` → PASS; `npx tsc --noEmit -p .` limpo.
- [ ] **Step 5:** Commit `feat(relatorios): rotas de atendimento, leads e funil`.

### Task 4: Página, cabeçalho, abas e menu

**Files:**
- Create: `app/app/relatorios/page.tsx`, `app/app/relatorios/_components/RelatoriosClient.tsx`, `app/app/relatorios/_components/CabecalhoDoPeriodo.tsx`, `hooks/relatorios/useRelatorio.ts`, `app/app/relatorios/relatorios-print.css`
- Modify: `lib/navigation/catalogo.ts` (item novo após `/app/metrics`: `href: "/app/relatorios"`, `label: "Relatórios"`, `description: "Atendimento, vendas e funil do período, com PDF."`, `icon: "ChartLine"` ou ícone existente equivalente, `group: "analise"`, `sidebar: true`)
- Test: `app/app/relatorios/_components/RelatoriosClient.test.tsx`

**Interfaces:**
- Produces: `useRelatorio<T>(aba: "atendimento" | "leads" | "funil", params: Record<string,string|undefined>)` (React Query, chave inclui params); `RelatoriosClient({ tzPadrao, periodoInicial, vendedores, funis })` com abas Atendimento, Templates Oficiais, Leads & Vendas, Metas & Produtos, Funil, Consumo de IA, Envio agendado — as quatro ainda não feitas mostram "Chega na próxima etapa".
- Período fica na URL (`?from&to&aba`) para o PDF/compartilhar; **Aplicar** grava na URL. Botão **PDF** chama `window.print()`; CSS de impressão esconde menu, cabeçalho de filtros e abas, e quebra página entre blocos.

- [ ] **Step 1: Teste** — renderiza as 7 abas pelo nome; clicar "Funil" troca o conteúdo; "Rastreador Inteligente" não existe.
- [ ] **Step 2:** FAIL → implementar → PASS (`npx vitest run app/app/relatorios`).
- [ ] **Step 3:** Commit `feat(relatorios): página, abas e menu`.

### Task 5: Aba Atendimento

**Files:**
- Create: `app/app/relatorios/_components/AbaAtendimento.tsx` e componentes de bloco em `app/app/relatorios/_components/blocos/` (`CartaoDoDia.tsx`, `GraficoPorDia.tsx`, `Rosca.tsx`, `MapaPorHora.tsx`, `TabelaRanking.tsx`)
- Test: `app/app/relatorios/_components/AbaAtendimento.test.tsx`

**Interfaces:**
- Consumes: payload de `/api/v1/reports/atendimento`.
- Produces: blocos reutilizáveis — `CartaoDoDia({ titulo, valor, variacao, trintaDias, formato: "numero"|"moeda" })`, `GraficoPorDia({ serie, chave, formato })`, `Rosca({ itens: {rotulo,total}[] , centro })`, `MapaPorHora({ horas })`, `TabelaRanking({ colunas, linhas, porPagina = 10 })`.

- [ ] **Step 1: Teste** — com payload fixo: cartão "Conversas hoje" mostra 7 e "-61,1%"; mapa tem 24 células; ranking ordena por conversas desc; `disponivel:false` mostra o aviso.
- [ ] **Step 2:** FAIL → implementar (filtro "Todos os atendentes" refaz a busca com `user_id`) → PASS.
- [ ] **Step 3:** Commit `feat(relatorios): aba Atendimento`.

### Task 6: Abas Leads & Vendas e Funil

**Files:**
- Create: `app/app/relatorios/_components/AbaLeadsEVendas.tsx`, `app/app/relatorios/_components/AbaFunil.tsx`
- Test: `app/app/relatorios/_components/AbaLeadsEVendas.test.tsx`, `app/app/relatorios/_components/AbaFunil.test.tsx`

**Interfaces:**
- Consumes: blocos da Task 5; payloads de `leads` e `funil`.

- [ ] **Step 1: Testes** — Leads: taxa de conversão = convertidos/total com 1 casa ("0,0%" quando total 0, nunca NaN); ticket médio = receita/vendas ("R$ 0,00" com 0 vendas); "Melhores dias" lista os 3 dias de maior receita. Funil: lista de funis com % do total; filtro de funil refaz a busca com `pipeline_id`.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** `npx tsc --noEmit -p .` e `npx vitest run app/app/relatorios lib/relatorios app/api/v1/reports` limpos.
- [ ] **Step 4:** Commit `feat(relatorios): abas Leads & Vendas e Funil`, push para `main`, e entregar ao usuário o SQL da migration 9111 para rodar no Studio.
