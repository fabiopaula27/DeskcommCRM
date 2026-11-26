"use client";

/**
 * Relatórios: o período no topo vale para todas as abas. As datas da tela são
 * dias no fuso da organização; viram instantes só na hora de buscar (`to` é o
 * início do dia seguinte, então o último dia entra inteiro).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import { inicioDoDia, somarDias } from "@/lib/relatorios/periodo";

import { AbaAtendimento } from "./AbaAtendimento";
import { AbaFunil } from "./AbaFunil";
import { AbaLeadsEVendas } from "./AbaLeadsEVendas";

export type Pessoa = { user_id: string; nome: string };
export type FunilOpcao = { id: string; nome: string };

export type FiltrosDoRelatorio = { from: string; to: string };

const ABAS = [
  { valor: "atendimento", rotulo: "Atendimento" },
  { valor: "templates", rotulo: "Templates Oficiais" },
  { valor: "leads", rotulo: "Leads & Vendas" },
  { valor: "metas", rotulo: "Metas & Produtos" },
  { valor: "funil", rotulo: "Funil" },
  { valor: "ia", rotulo: "Consumo de IA" },
  { valor: "envio", rotulo: "Envio agendado" },
] as const;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

type ValorDaAba = (typeof ABAS)[number]["valor"];

function abaValida(v: string | null): v is ValorDaAba {
  return ABAS.some((a) => a.valor === v);
}

export function RelatoriosClient({
  periodoInicial,
  tz,
  moeda,
  pessoas,
  funis,
}: {
  periodoInicial: { from: string; to: string };
  tz: string;
  moeda: string;
  pessoas: Pessoa[];
  funis: FunilOpcao[];
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const busca = useSearchParams();

  const abaDaUrl = busca.get("aba");
  const [aba, setAba] = useState<ValorDaAba>(abaValida(abaDaUrl) ? abaDaUrl : "atendimento");
  // Período da URL só vale se for dia válido e em ordem; senão, o padrão.
  const deUrl = busca.get("de");
  const ateUrl = busca.get("ate");
  const urlValida =
    !!deUrl && !!ateUrl && DIA.test(deUrl) && DIA.test(ateUrl) && deUrl <= ateUrl &&
    !Number.isNaN(Date.parse(deUrl)) && !Number.isNaN(Date.parse(ateUrl));
  const [de, setDe] = useState(urlValida ? deUrl : periodoInicial.from);
  const [ate, setAte] = useState(urlValida ? ateUrl : periodoInicial.to);
  const [aplicado, setAplicado] = useState({ de, ate });

  const filtros: FiltrosDoRelatorio = useMemo(
    () => ({
      from: inicioDoDia(aplicado.de, tz).toISOString(),
      to: inicioDoDia(somarDias(aplicado.ate, 1), tz).toISOString(),
    }),
    [aplicado, tz],
  );

  const periodoInvalido = !de || !ate || de > ate;

  function gravarNaUrl(proxima: { aba?: string; de?: string; ate?: string }) {
    const p = new URLSearchParams(busca.toString());
    for (const [k, v] of Object.entries(proxima)) if (v) p.set(k, v);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  function aplicar() {
    if (periodoInvalido) return;
    setAplicado({ de, ate });
    gravarNaUrl({ de, ate });
  }

  return (
    <div id="relatorio-impressao" className="flex flex-col gap-6 md:p-6 print:p-0">
      {/* PDF pela impressão do navegador: só o relatório vai para o papel, sem o
          menu e a barra do app (que vivem fora desta árvore). */}
      <style>{`@media print {
        body * { visibility: hidden; }
        #relatorio-impressao, #relatorio-impressao * { visibility: visible; }
        #relatorio-impressao { position: absolute; inset: 0 auto auto 0; width: 100%; }
        @page { margin: 12mm; }
      }`}</style>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Relatórios")}</h1>
          <p className="text-sm text-text-muted">
            {t("Como a empresa foi no período escolhido.")}
            <span className="hidden print:inline">
              {" "}
              {aplicado.de.split("-").reverse().join("/")} – {aplicado.ate.split("-").reverse().join("/")}
            </span>
          </p>
        </div>
        <form
          className="flex flex-wrap items-end gap-2 print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            aplicar();
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("De")}
            <Input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("Até")}
            <Input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className="w-40" />
          </label>
          <Button type="submit" disabled={periodoInvalido}>
            {t("Aplicar")}
          </Button>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            {t("Baixar PDF")}
          </Button>
        </form>
      </header>

      <Tabs
        value={aba}
        onValueChange={(v) => {
          if (!abaValida(v)) return;
          setAba(v);
          gravarNaUrl({ aba: v });
        }}
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start print:hidden">
          {ABAS.map((a) => (
            <TabsTrigger key={a.valor} value={a.valor}>
              {t(a.rotulo)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="atendimento" className="mt-4">
          <AbaAtendimento filtros={filtros} moeda={moeda} pessoas={pessoas} />
        </TabsContent>
        <TabsContent value="leads" className="mt-4">
          <AbaLeadsEVendas filtros={filtros} moeda={moeda} pessoas={pessoas} />
        </TabsContent>
        <TabsContent value="funil" className="mt-4">
          <AbaFunil filtros={filtros} moeda={moeda} funis={funis} />
        </TabsContent>
        {(["templates", "metas", "ia", "envio"] as const).map((v) => (
          <TabsContent key={v} value={v} className="mt-4">
            <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-sm text-text-muted">
              {t("Chega na próxima etapa dos relatórios.")}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
