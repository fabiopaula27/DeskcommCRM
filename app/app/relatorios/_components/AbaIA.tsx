"use client";

import { useT } from "@/hooks/i18n/useT";
import { useRelatorio, type Indisponivel } from "@/hooks/relatorios/useRelatorio";

import { AvisoDaAba, Bloco, Carregando, GraficoPorDia, Numero, Vazio } from "./blocos/Blocos";
import { CORES, formatarNumero } from "./blocos/formato";
import type { FiltrosDoRelatorio } from "./RelatoriosClient";

export type DadosDeIA = {
  disponivel: true;
  tokens: number;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache: number;
  custo_cents: number;
  chamadas: number;
  turnos: number;
  custo_por_turno_cents: number | null;
  por_uso: { uso: string; tokens: number; custo_cents: number; chamadas: number }[];
  por_dia: { dia: string; tokens: number; custo_cents: number }[];
  historico: { mes: string; tokens: number; custo_cents: number; chamadas: number }[];
};

const usd = (cents: number | null) =>
  cents === null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "USD" });

function rotuloDoMes(mes: string): string {
  const d = new Date(`${mes}-15T12:00:00Z`);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(".", "");
}

export function AbaIA({ filtros }: { filtros: FiltrosDoRelatorio }) {
  const t = useT();
  const { data, isLoading, isError } = useRelatorio<DadosDeIA>("ia", { ...filtros });

  if (isLoading) return <Carregando />;
  if (isError || !data) return <AvisoDaAba texto={t("Não consegui carregar o relatório agora. Tente de novo em instantes.")} />;
  const d = data.data as DadosDeIA | Indisponivel;
  if (!d.disponivel) return <AvisoDaAba texto={d.motivo} />;

  const maiorUso = Math.max(1, ...d.por_uso.map((u) => u.tokens));
  const maiorMes = Math.max(1, ...d.historico.map((h) => h.tokens));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* O número que o dono procura primeiro: quanto a IA trabalhou e quanto custou. */}
        <section className="rounded-lg border border-border bg-text p-6 text-bg shadow-sm break-inside-avoid print:border-text print:bg-surface print:text-text">
          <p className="text-xs opacity-70">{t("Tokens usados no período")}</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight">{formatarNumero(d.tokens)}</p>
          <p className="mt-4 text-sm tabular-nums">
            {t("Custo estimado:")} <strong>{usd(d.custo_cents)}</strong>
          </p>
          <p className="mt-1 text-xs opacity-70">
            {t("Pelo preço de tabela do provedor. A cobrança real é feita na conta da sua chave de IA.")}
          </p>
        </section>
        <Bloco titulo={t("Como os tokens se dividem")} className="lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Numero rotulo={t("Entrada (o que a IA leu)")} valor={formatarNumero(d.tokens_entrada)} />
            <Numero rotulo={t("Saída (o que a IA escreveu)")} valor={formatarNumero(d.tokens_saida)} />
            <Numero rotulo={t("Cache (reaproveitado, mais barato)")} valor={formatarNumero(d.tokens_cache)} />
            <Numero rotulo={t("Chamadas à IA")} valor={formatarNumero(d.chamadas)} />
            <Numero rotulo={t("Atendimentos da IA")} valor={formatarNumero(d.turnos)} tom="destaque" />
            <Numero rotulo={t("Custo por atendimento")} valor={usd(d.custo_por_turno_cents)} tom="alerta" />
          </div>
        </Bloco>
      </div>

      {d.tokens === 0 ? (
        <Bloco titulo={t("Consumo por dia")}>
          <Vazio texto={t("A IA não foi usada no período.")} />
        </Bloco>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Bloco titulo={t("Tokens por dia")} className="lg:col-span-2">
            <GraficoPorDia serie={d.por_dia} chave="tokens" cor={CORES[1]} />
          </Bloco>
          <Bloco titulo={t("Onde a IA foi usada")}>
            <ul className="space-y-3">
              {d.por_uso.map((u, i) => (
                <li key={u.uso}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    <span className="truncate">{t(u.uso)}</span>
                    <span className="tabular-nums text-text-muted">{usd(u.custo_cents)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-elevated">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${(u.tokens / maiorUso) * 100}%`, background: CORES[i % CORES.length] }}
                    />
                  </div>
                  <p className="mt-0.5 text-[11px] tabular-nums text-text-subtle">
                    {formatarNumero(u.tokens)} {t("tokens")}
                  </p>
                </li>
              ))}
            </ul>
          </Bloco>
        </div>
      )}

      <Bloco titulo={t("Histórico de consumo")} descricao={t("Tokens por mês nos últimos 12 meses.")}>
        {d.historico.length === 0 ? (
          <Vazio texto={t("Ainda não há consumo registrado.")} />
        ) : (
          <div className="flex h-48 items-end gap-2" data-testid="historico-ia">
            {d.historico.map((h) => (
              <div key={h.mes} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-text-subtle">{usd(h.custo_cents)}</span>
                <div
                  className="w-full max-w-12 rounded-t-sm"
                  title={`${formatarNumero(h.tokens)} ${t("tokens")}`}
                  style={{ height: `${Math.max(2, (h.tokens / maiorMes) * 100)}%`, background: "var(--color-info)" }}
                />
                <span className="text-[11px] text-text-muted">{rotuloDoMes(h.mes)}</span>
              </div>
            ))}
          </div>
        )}
      </Bloco>
    </div>
  );
}
