"use client";

/**
 * Os blocos dos Relatórios. Um número em destaque por bloco, o resto quieto:
 * a tela é lida pelo dono da empresa em segundos, não estudada.
 */
import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import type { Variacao } from "@/lib/relatorios/series";

import { CORES, formatarNumero, rotuloDoDia } from "./formato";

export function Bloco({
  titulo,
  descricao,
  acao,
  children,
  className = "",
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface p-5 shadow-xs break-inside-avoid ${className}`}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-text">{titulo}</h2>
          {descricao ? <p className="mt-0.5 text-xs text-text-muted">{descricao}</p> : null}
        </div>
        {acao ? <div className="print:hidden">{acao}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Numero({
  rotulo,
  valor,
  tom = "neutro",
}: {
  rotulo: string;
  valor: string;
  tom?: "neutro" | "destaque" | "sucesso" | "alerta";
}) {
  const cor = {
    neutro: "text-text",
    destaque: "text-accent",
    sucesso: "text-success-fg",
    alerta: "text-warning-fg",
  }[tom];
  return (
    <div className="min-w-[7rem] rounded-md border border-border bg-bg px-3 py-2">
      <p className="text-[11px] text-text-muted">{rotulo}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${cor}`}>{valor}</p>
    </div>
  );
}

function TextoDaVariacao({ v }: { v: Variacao }) {
  const t = useT();
  if (v.tipo === "igual") return <span className="text-text-muted">{t("igual a ontem")}</span>;
  if (v.tipo === "novo") return <span className="text-success-fg">{t("novo hoje")}</span>;
  const sobe = v.pct > 0;
  return (
    <span className={sobe ? "text-success-fg" : "text-error-fg"}>
      {sobe ? "▲" : "▼"} {Math.abs(v.pct).toLocaleString("pt-BR")}%
      <span className="ml-1 text-text-muted">{t("vs ontem")}</span>
    </span>
  );
}

/** O pulso do dia: o número de hoje grande, ontem e 30 dias pequenos. */
export function CartaoDoDia({
  titulo,
  hoje,
  variacao,
  trintaDias,
}: {
  titulo: string;
  hoje: string;
  variacao: Variacao;
  trintaDias: string;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-xs break-inside-avoid">
      <p className="text-xs font-medium text-text-muted">{titulo}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-text">{hoje}</p>
      <p className="mt-2 text-xs tabular-nums">
        <TextoDaVariacao v={variacao} />
      </p>
      <p className="mt-1 text-xs text-text-subtle">
        {t("Últimos 30 dias:")} <span className="tabular-nums text-text-muted">{trintaDias}</span>
      </p>
    </div>
  );
}

export function GraficoPorDia<T extends { dia: string }>({
  serie,
  chave,
  cor = CORES[0],
  formatar = (n: number) => formatarNumero(n),
  altura = 240,
}: {
  serie: T[];
  chave: keyof T & string;
  cor?: string;
  formatar?: (n: number) => string;
  altura?: number;
}) {
  const id = `grad-${chave}`;
  return (
    <div style={{ height: altura }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={cor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="dia"
            tickFormatter={(v: string) => rotuloDoDia(v)}
            tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatar(v)}
          />
          <Tooltip
            labelFormatter={(v) => rotuloDoDia(String(v))}
            formatter={(v) => formatar(Number(v))}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12 }}
          />
          <Area type="monotone" dataKey={chave as string} stroke={cor} strokeWidth={2} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Rosca com a legenda ao lado: o total no centro, cada fatia com número e %. */
export function Rosca({
  itens,
  rotuloDoCentro,
}: {
  itens: { rotulo: string; total: number }[];
  rotuloDoCentro: string;
}) {
  const t = useT();
  const total = itens.reduce((s, i) => s + i.total, 0);
  if (total === 0) return <Vazio texto={t("Nada no período escolhido.")} />;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={itens} dataKey="total" nameKey="rotulo" innerRadius="68%" outerRadius="100%" stroke="none">
              {itens.map((_, i) => (
                <Cell key={i} fill={CORES[i % CORES.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-text-muted">{rotuloDoCentro}</span>
          <span className="text-2xl font-semibold tabular-nums">{formatarNumero(total)}</span>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {itens.map((i, idx) => (
          <li key={i.rotulo} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: CORES[idx % CORES.length] }} />
              <span className="truncate">{i.rotulo}</span>
            </span>
            <span className="tabular-nums text-text-muted">
              {formatarNumero(i.total)} · {Math.round((i.total / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 24 células, a intensidade é a parte daquela hora no pico do período. */
export function MapaPorHora({
  horas,
  titulo,
  cor = "var(--color-accent)",
}: {
  horas: { hora: number; total: number }[];
  titulo: string;
  cor?: string;
}) {
  const pico = Math.max(1, ...horas.map((h) => h.total));
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-text-muted">{titulo}</p>
      <div className="grid grid-cols-12 gap-1 md:grid-cols-24" data-testid="mapa-por-hora">
        {horas.map((h) => (
          <div key={h.hora} className="flex flex-col items-center gap-1">
            <div
              title={`${String(h.hora).padStart(2, "0")}h · ${h.total}`}
              className="h-8 w-full rounded-sm border border-border"
              style={{
                background: h.total === 0 ? "var(--color-bg)" : cor,
                opacity: h.total === 0 ? 1 : 0.18 + 0.82 * (h.total / pico),
              }}
            />
            <span className="text-[10px] tabular-nums text-text-subtle">{String(h.hora).padStart(2, "0")}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type Coluna<T> = {
  titulo: string;
  valor: (linha: T) => ReactNode;
  alinhar?: "esquerda" | "direita";
};

/** Ranking com posição, nome e e-mail, paginado no cliente. */
export function TabelaRanking<T>({
  colunas,
  linhas,
  nome,
  porPagina = 10,
  vazio,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  nome: (linha: T) => { nome: string; detalhe?: string | null };
  porPagina?: number;
  vazio: string;
}) {
  const t = useT();
  const [pagina, setPagina] = useState(0);
  if (linhas.length === 0) return <Vazio texto={vazio} />;
  const paginas = Math.ceil(linhas.length / porPagina);
  const atual = linhas.slice(pagina * porPagina, (pagina + 1) * porPagina);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="w-10 py-2 font-medium">#</th>
              <th className="py-2 font-medium">{t("Nome")}</th>
              {colunas.map((c) => (
                <th key={c.titulo} className={`py-2 font-medium ${c.alinhar === "esquerda" ? "" : "text-right"}`}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {atual.map((linha, i) => {
              const pos = pagina * porPagina + i + 1;
              const n = nome(linha);
              return (
                <tr key={pos} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5">
                    <span
                      className={`inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${
                        pos === 1 ? "bg-accent text-accent-fg" : "bg-surface-elevated text-text-muted"
                      }`}
                    >
                      {pos}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <p className="font-medium text-text">{n.nome}</p>
                    {n.detalhe ? <p className="text-xs text-text-subtle">{n.detalhe}</p> : null}
                  </td>
                  {colunas.map((c) => (
                    <td key={c.titulo} className={`py-2.5 tabular-nums ${c.alinhar === "esquerda" ? "" : "text-right"}`}>
                      {c.valor(linha)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginas > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-text-muted print:hidden">
          <button
            type="button"
            className="rounded border border-border px-2 py-1 disabled:opacity-40"
            disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}
          >
            {t("Anterior")}
          </button>
          <span className="tabular-nums">
            {pagina + 1}/{paginas}
          </span>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 disabled:opacity-40"
            disabled={pagina + 1 >= paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            {t("Próxima")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return <p className="py-6 text-center text-sm text-text-muted">{texto}</p>;
}

export function Carregando() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="grid gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function AvisoDaAba({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-bg p-4 text-sm text-warning-fg">{texto}</div>
  );
}
