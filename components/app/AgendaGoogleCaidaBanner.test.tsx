import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

import { conexaoDaAgendaCaiu } from "@/lib/agenda/google/conexao-caida";

import { AgendaGoogleCaidaBanner } from "./AgendaGoogleCaidaBanner";

describe("faixa da agenda do Google desconectada", () => {
  it("status que pedem reconectar contam como caída", () => {
    for (const s of ["token_expired", "scope_missing", "disconnected", "error"]) expect(conexaoDaAgendaCaiu(s)).toBe(true);
    for (const s of ["healthy", "connecting", "rate_limited"]) expect(conexaoDaAgendaCaiu(s)).toBe(false);
  });

  it("mostra a conta e o caminho para reconectar", () => {
    render(<AgendaGoogleCaidaBanner caida={{ email: "laspjunior@gmail.com" }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/laspjunior@gmail\.com/);
    expect(screen.getByRole("link", { name: "Reconectar agenda" }).getAttribute("href")).toBe("/app/settings/tenant/agenda");
  });

  it("sem conexão caída não mostra nada", () => {
    const { container } = render(<AgendaGoogleCaidaBanner caida={null} />);
    expect(container.innerHTML).toBe("");
  });
});
