"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useRelatorio, type Indisponivel } from "@/hooks/relatorios/useRelatorio";

import { AvisoDaAba, Bloco, Carregando, GraficoDeDuasLinhas, Numero, Vazio } from "./blocos/Blocos";
import { formatarNumero, formatarPct, razao } from "./blocos/formato";
import type { FiltrosDoRelatorio } from "./RelatoriosClient";

export type DadosDeTemplates = {
  disponivel: true;
  enviados: number;
  respondidos: number;
  gasto_estimado_usd: number;
  por_dia: { dia: string; enviados: number; respondidos: number }[];
  por_template: {
    nome: string;
    categoria: string | null;
    enviados: number;
    respondidos: number;
    gasto_estimado_usd: number;
  }[];
  nomes: string[];
};

const usd = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "USD" });

const CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

export function AbaTemplates({ filtros }: { filtros: FiltrosDoRelatorio }) {
  const t = useT();
  const [template, setTemplate] = useState("");
  const { data, isLoading, isError } = useRelatorio<DadosDeTemplates>("templates", {
    ...filtros,
    template: template || undefined,
  });

  if (isLoading) return <Carregando />;
  if (isError || !data) return <AvisoDaAba texto={t("Não consegui carregar o relatório agora. Tente de novo em instantes.")} />;
  const d = data.data as DadosDeTemplates | Indisponivel;
  if (!d.disponivel) return <AvisoDaAba texto={d.motivo} />;

  return (
    <Bloco
      titulo={t("Templates da API Oficial")}
      descricao={t("Mensagens enviadas por modelo aprovado e quantas tiveram resposta do cliente em até 24 horas.")}
      acao={
        <select
          aria-label={t("Filtrar por template")}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="h-9 max-w-xs rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="">{t("Todos os templates")}</option>
          {d.nomes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      }
    >
      <div className="mb-2 flex flex-wrap gap-2">
        <Numero rotulo={t("Enviados")} valor={formatarNumero(d.enviados)} tom="destaque" />
        <Numero rotulo={t("Respondidos")} valor={formatarNumero(d.respondidos)} tom="sucesso" />
        <Numero rotulo={t("Taxa de resposta")} valor={formatarPct(razao(d.respondidos, d.enviados))} tom="alerta" />
        <Numero rotulo={t("Gasto estimado")} valor={`≈ ${usd(d.gasto_estimado_usd)}`} />
      </div>
      <p className="mb-5 text-xs text-text-subtle">
        {t("Estimativa para destinatários do Brasil: enviados × tarifa da categoria. A Meta cobra por mensagem entregue, então o valor real pode variar.")}
      </p>

      {d.enviados === 0 ? (
        <Vazio texto={t("Nenhum template foi enviado no período.")} />
      ) : (
        <>
          <GraficoDeDuasLinhas
            serie={d.por_dia}
            a={{ chave: "enviados", rotulo: t("Enviados"), cor: "var(--color-accent)" }}
            b={{ chave: "respondidos", rotulo: t("Respondidos"), cor: "var(--color-success)" }}
          />
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="py-2 font-medium">{t("Template")}</th>
                  <th className="py-2 font-medium">{t("Categoria")}</th>
                  <th className="py-2 text-right font-medium">{t("Enviados")}</th>
                  <th className="py-2 text-right font-medium">{t("Respondidos")}</th>
                  <th className="py-2 text-right font-medium">{t("Taxa de resposta")}</th>
                  <th className="py-2 text-right font-medium">{t("Gasto estimado")}</th>
                </tr>
              </thead>
              <tbody>
                {d.por_template.map((x) => (
                  <tr key={x.nome} className="border-b border-border/60 last:border-0">
                    <td className="py-2 font-medium">{x.nome}</td>
                    <td className="py-2 text-text-muted">{x.categoria ? t(CATEGORIA[x.categoria] ?? x.categoria) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{formatarNumero(x.enviados)}</td>
                    <td className="py-2 text-right tabular-nums">{formatarNumero(x.respondidos)}</td>
                    <td className="py-2 text-right tabular-nums">{formatarPct(razao(x.respondidos, x.enviados))}</td>
                    <td className="py-2 text-right tabular-nums">≈ {usd(x.gasto_estimado_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Bloco>
  );
}
