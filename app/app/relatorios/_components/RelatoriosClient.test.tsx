import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/app/relatorios",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./AbaAtendimento", () => ({ AbaAtendimento: () => <p>conteudo-atendimento</p> }));
vi.mock("./AbaLeadsEVendas", () => ({ AbaLeadsEVendas: () => <p>conteudo-leads</p> }));
vi.mock("./AbaFunil", () => ({ AbaFunil: () => <p>conteudo-funil</p> }));
vi.mock("./AbaMetasEProdutos", () => ({ AbaMetasEProdutos: () => <p>conteudo-metas</p> }));
vi.mock("./AbaTemplates", () => ({ AbaTemplates: () => <p>conteudo-templates</p> }));

import { RelatoriosClient } from "./RelatoriosClient";

const props = {
  periodoInicial: { from: "2026-11-01", to: "2026-11-26" },
  tz: "America/Sao_Paulo",
  moeda: "BRL",
  pessoas: [],
  funis: [],
};

describe("RelatoriosClient", () => {
  it("mostra as 7 abas e não tem Rastreador Inteligente", () => {
    render(<RelatoriosClient {...props} />);
    for (const nome of [
      "Atendimento",
      "Templates Oficiais",
      "Leads & Vendas",
      "Metas & Produtos",
      "Funil",
      "Consumo de IA",
      "Envio agendado",
    ]) {
      expect(screen.getByRole("tab", { name: nome })).toBeTruthy();
    }
    expect(screen.queryByRole("tab", { name: /Rastreador/ })).toBeNull();
    expect(screen.getByText("conteudo-atendimento")).toBeTruthy();
  });

  it("trocar para Funil mostra o conteúdo do funil", () => {
    render(<RelatoriosClient {...props} />);
    const aba = screen.getByRole("tab", { name: "Funil" });
    fireEvent.mouseDown(aba);
    fireEvent.click(aba);
    expect(screen.getByText("conteudo-funil")).toBeTruthy();
  });

  it("aba ainda não construída avisa que chega na próxima etapa", () => {
    render(<RelatoriosClient {...props} />);
    const aba = screen.getByRole("tab", { name: "Consumo de IA" });
    fireEvent.mouseDown(aba);
    fireEvent.click(aba);
    expect(screen.getByText("Chega na próxima etapa dos relatórios.")).toBeTruthy();
  });
});

describe("período vindo da URL", () => {
  it("data inválida na URL não derruba a página", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ replace: vi.fn() }),
      usePathname: () => "/app/relatorios",
      useSearchParams: () => new URLSearchParams("de=foo&ate=2026-11-01"),
    }));
    const { RelatoriosClient: Cliente } = await import("./RelatoriosClient");
    render(<Cliente {...props} />);
    expect((screen.getByLabelText("De") as HTMLInputElement).value).toBe("2026-11-01");
  });
});
