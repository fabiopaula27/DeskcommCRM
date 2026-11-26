# Relatórios (menu Análise) — design

Data: 2026-11-26 · Status: aguardando aprovação final

## Intenção

O **dono da empresa** (organização do CRM) acompanha o desempenho do próprio negócio num
lugar só: atendimento, templates oficiais, leads e vendas, metas e produtos, funil e consumo
de IA, num período escolhido, com PDF e envio automático por e-mail/WhatsApp.

Referência visual: 11 prints enviados pelo usuário (abas Atendimento, Templates Oficiais,
Leads & Vendas, Metas & Produtos, Funil, Tokens OpenAI, Envio agendado). A aba
"Rastreador Inteligente" foi **removida** a pedido.

## Objetivos

- Página `/app/relatorios`, no grupo **Análise** do menu (`lib/navigation/catalogo.ts`).
- Cabeçalho: período (de/até, padrão = dia 1 do mês até hoje), botão **Aplicar**, botão **PDF**.
  Nas abas Leads & Vendas e Metas & Produtos, filtro **Todos os vendedores / um vendedor**.
- 7 abas, cada uma com os blocos dos prints, alimentados por dados reais.
- PDF gerado no servidor (um arquivo por aba ou do relatório inteiro), usado pelo botão e pelo envio agendado.
- Envio agendado: frequência, horário, formato, lista de e-mails, lista de telefones e canal de envio.

## Não-objetivos

- Rastreador Inteligente.
- Franquia/créditos pré-pagos de tokens "globais" (o print vem de outro produto; o CRM usa a
  chave da própria empresa). A aba de IA mostra o que o CRM realmente registra.
- Editar dados a partir do relatório (é só leitura).

## Antiobjetivos (falharia mesmo "funcionando")

- Número diferente do que a tela de **Métricas** mostra para o mesmo período e filtro.
- Mostrar dado de outra organização (toda consulta pela org ativa, validada no servidor).
- Página lenta em empresa com dezenas de milhares de mensagens (somas no banco, não no navegador).
- Atendente comum vendo receita da empresa (piso de papel `manager`, como Métricas).

## Restrições

- Next.js App Router, Supabase/Postgres, `recharts` (já instalado), `@react-pdf/renderer`
  (já usado em `lib/conversas/exporta-pdf.ts`).
- Fuso: o da organização (`organizations.timezone`), como `metrics/serie`.
- SQL novo é aplicado manualmente no Supabase Studio pelo usuário: migrations curtas e
  idempotentes; o código degrada (bloco "sem dados") se a migration ainda não rodou.
- Design segue o sistema visual atual do CRM (tokens de cor e componentes `components/ui`),
  com o cuidado do skill frontend-design: hierarquia clara, um destaque por aba, sem enfeite.

## Abordagens consideradas

- **Números: (A) uma consulta por aba no servidor** — escolhida. Somas no banco, reaproveita
  as funções de Métricas (`fn_attendant_metrics`, `fn_channel_metrics`, rotas `metrics/funil`,
  `metrics/metas`, `metrics/serie`) e `fn_uso_de_ia`. (B) buscar dados brutos e somar no
  navegador: descartada (lenta e diverge de Métricas).
- **PDF: (B) gerado no servidor** — escolhida, porque o envio agendado roda sem navegador.
  Até a parte 4, o botão PDF usa `window.print()` com folha de estilo de impressão.

## O que cada aba mostra (e de onde vem)

1. **Atendimento** — cartões Conversas/Leads/Vendas/Receita **de hoje** com variação vs ontem e
   total de 30 dias; Conversas por dia (total, ativas, pausadas, tempo médio de atendimento,
   tempo da 1ª resposta); Por canal (rosca); Mensagens (enviadas, por atendente, pela IA,
   recebidas, média por conversa, filtro por atendente, mapa de calor por hora para humanos e IA,
   mensagens da IA por dia); Performance de atendentes (conversas, mensagens, leads, vendas,
   conversão, paginado); Distribuição por fila (contagem de distribuições por atendente, filtro
   por fila). Fontes: `conversations`, `messages` (direção e autor humano/IA), `crm_leads`,
   `sales`, `fn_attendant_metrics`, `fn_channel_metrics`, eventos de distribuição do rodízio.
2. **Templates Oficiais** — filtro por template; enviados, respondidos, taxa de resposta, gasto
   estimado (enviados × tarifa por categoria no Brasil, rotulado como estimativa); evolução
   diária; tabela por template. Fontes: `messages` com template + `meta_templates`.
3. **Leads & Vendas** — Leads por dia (total, convertidos, taxa); Origens (rosca); Vendas por dia
   (total, receita, ticket médio); Resumo de vendas com melhores dias; Vendas por vendedor.
   Fontes: `crm_leads`, `sales`, `metrics/serie`.
4. **Metas & Produtos** — Metas (total, valor, receita realizada, atingimento, progresso, meta
   diária vs realizado, por funil e por atendente); Produtos (produtos, itens vendidos, receita,
   descontos, vendas por dia, volume por hora, top produtos, por vendedor).
   Fontes: `crm_metas`, `sales`, `sale_items`, `catalog_products`, `metrics/metas`.
5. **Funil** — barras por funil, rosca "pessoas por funil" com valor em oportunidades, lista
   "Funis do CRM" com leads, valor e %. Filtro por funil. Fontes: `crm_pipelines`, `crm_stages`,
   `crm_leads`, `metrics/funil`.
6. **Consumo de IA** (no print "Tokens OpenAI"; nome neutro porque a empresa pode usar outros
   provedores) — total de tokens do período, por provedor/credencial, custo estimado e
   histórico mensal/diário paginado. Fonte: `fn_uso_de_ia` (0586).
7. **Envio agendado** — formulário dos prints; grava numa tabela nova `report_schedules`
   (org, frequência diária/semanal/mensal, horário, formato PDF, e-mails[], telefones[],
   canal, abas incluídas, ativo, último envio). Um cron novo `report-schedules` gera o PDF e
   envia por e-mail (provedor de e-mail já configurado) e por WhatsApp (canal escolhido).

Acréscimos propostos (não estão nos prints): na aba Atendimento, "conversas sem resposta há
mais de 10 min" no período; em todos os gráficos, estado vazio explicando o que fazer.

## Entrega em partes (cada parte vai ao ar funcionando)

1. Página, cabeçalho, abas, Atendimento, Leads & Vendas, Funil, PDF por impressão.
2. Metas & Produtos e Templates Oficiais.
3. Consumo de IA.
4. PDF no servidor + Envio agendado (tabela, tela, cron, e-mail, WhatsApp).

## Decidido com o usuário

- **Período do envio agendado:** diário = ontem; semanal = semana anterior (segunda a domingo);
  mensal = mês anterior inteiro. Os cartões "hoje vs ontem" mostram o dia atual na tela e o
  último dia do período no PDF agendado.
- **Acesso:** dono e gerentes (`manager`+) veem tudo, inclusive receita por vendedor;
  atendentes/vendedores não veem a página. Só dono/admin cria e edita o envio agendado.

## Decisões do autor (confira)

- **Bater com Métricas:** números que existem nas duas telas usam o MESMO cálculo (extraído para
  `lib/relatorios/` quando estiver inline numa rota). Números sem equivalente ganham SQL novo.
- **Fuso:** sempre o da organização; período inclui o dia final inteiro.
- **Dado que o sistema não registra** (ex.: autor humano/IA da mensagem, resposta ligada ao
  template, eventos de distribuição por fila, metas por funil/atendente): o construtor verifica
  primeiro; o que não existir mostra o bloco com "este dado começa a ser registrado a partir de
  hoje" e ganha captura nova — sem inventar número para o passado.
- **Custos:** tarifa de template por categoria (Brasil) e preço por modelo de IA ficam numa tabela
  no código, rotulados "estimativa"; o custo de IA usa `cost_cents` quando já gravado.
- **E-mail:** o provedor configurado em Admin › E-mail da instalação; PDF como anexo.
- **WhatsApp:** PDF enviado como documento pelos números por QR (Evolution/WAHA). API oficial fica
  fora do envio agendado (exigiria template aprovado fora da janela de 24 h).
- **Agendamento:** cron novo na infraestrutura de cron existente (`app/api/v1/cron/*`), a cada 15
  min, horário no fuso da organização; falha registra o erro no agendamento e tenta no próximo ciclo
  uma única vez.
- **Gráficos no PDF:** desenhados com os primitivos de SVG do `@react-pdf` (barras e linhas
  simples), não com `recharts`.

## Deixado ao construtor

Nome exato das rotas (`/api/v1/reports/<aba>`), quais funções SQL novas são necessárias para
somar no banco, layout fino de cada bloco, paginação, e como reaproveitar os cálculos de Métricas
sem duplicar regra (extrair para `lib/` quando a rota atual tiver a lógica inline).
