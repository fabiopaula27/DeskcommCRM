"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useRelatorio, type Indisponivel } from "@/hooks/relatorios/useRelatorio";

import { AvisoDaAba, Bloco, Carregando, Rosca, Vazio } from "./blocos/Blocos";
import { CORES, formatarMoeda, formatarNumero } from "./blocos/formato";
import type { FiltrosDoRelatorio, FunilOpcao } from "./RelatoriosClient";

export type DadosDoFunil = {
  disponivel: true;
  funis: { pipeline_id: string; nome: string; posicao: number; leads: number; valor_cents: number }[];
  etapas: { pipeline_id: string; stage_id: string; nome: string; posicao: number; leads: number }[];
};

export function AbaFunil({
  filtros,
  moeda,
  funis: opcoes,
}: {
  filtros: FiltrosDoRelatorio;
  moeda: string;
  funis: FunilOpcao[];
}) {
  const t = useT();
  const [funil, setFunil] = useState("");
  const { data, isLoading, isError } = useRelatorio<DadosDoFunil>("funil", {
    ...filtros,
    pipeline_id: funil || undefined,
  });

  if (isLoading) return <Carregando />;
  if (isError || !data) return <AvisoDaAba texto={t("Não consegui carregar o relatório agora. Tente de novo em instantes.")} />;
  const d = data.data as DadosDoFunil | Indisponivel;
  if (!d.disponivel) return <AvisoDaAba texto={d.motivo} />;

  const total = d.funis.reduce((s, f) => s + f.leads, 0);
  const valorTotal = d.funis.reduce((s, f) => s + f.valor_cents, 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  // Com um funil escolhido, as barras são as etapas dele; sem filtro, os funis.
  const barras = funil
    ? d.etapas.map((e) => ({ id: e.stage_id, nome: e.nome, leads: e.leads }))
    : d.funis.map((f) => ({ id: f.pipeline_id, nome: f.nome, leads: f.leads }));
  const maior = Math.max(1, ...barras.map((b) => b.leads));

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Bloco
        titulo={funil ? t("Leads por etapa") : t("Leads por funil")}
        descricao={t("Leads que entraram no período.")}
        className="lg:col-span-3"
        acao={
          <select
            aria-label={t("Filtrar por funil")}
            value={funil}
            onChange={(e) => setFunil(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">{t("Todos os funis")}</option>
            {opcoes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        }
      >
        {barras.length === 0 ? (
          <Vazio texto={t("Nenhum funil para mostrar.")} />
        ) : (
          <ul className="space-y-3">
            {barras.map((b, i) => (
              <li key={b.id}>
                <div className="mb-1 flex justify-between gap-2 text-sm">
                  <span className="truncate">{b.nome}</span>
                  <span className="tabular-nums text-text-muted">{formatarNumero(b.leads)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-surface-elevated">
                  <div
                    className="h-2.5 rounded-full"
                    style={{ width: `${(b.leads / maior) * 100}%`, background: CORES[i % CORES.length] }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 border-t border-border pt-5">
          <p className="mb-3 text-xs font-medium text-text-muted">
            {t("Pessoas por funil")} · {formatarMoeda(valorTotal, moeda)} {t("em oportunidades")}
          </p>
          <Rosca rotuloDoCentro={t("Pessoas")} itens={d.funis.map((f) => ({ rotulo: f.nome, total: f.leads }))} />
        </div>
      </Bloco>

      <Bloco titulo={t("Funis do CRM")} className="lg:col-span-2">
        <ul className="space-y-2">
          {d.funis.map((f, i) => (
            <li key={f.pipeline_id} className="rounded-md border border-border bg-bg p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white"
                    style={{ background: CORES[i % CORES.length] }}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{f.nome}</span>
                </span>
                <span className="text-right text-xs tabular-nums">
                  <span className="block font-semibold text-text">
                    {formatarNumero(f.leads)} {t("leads")}
                  </span>
                  <span className="text-text-muted">{formatarMoeda(f.valor_cents, moeda)}</span>
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-surface-elevated">
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${pct(f.leads)}%`, background: CORES[i % CORES.length] }}
                  />
                </div>
                <span className="w-10 text-right text-xs tabular-nums text-text-muted">{pct(f.leads)}%</span>
              </div>
            </li>
          ))}
        </ul>
      </Bloco>
    </div>
  );
}
