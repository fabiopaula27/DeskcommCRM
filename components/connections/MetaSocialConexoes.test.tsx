import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (k: string) => k }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
let busca = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => busca }));

let estado: unknown;
const apagar = vi.fn(async () => ({}));
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: async () => ({ data: estado }), delete: (...a: unknown[]) => apagar(...(a as [])) },
}));

import { MetaSocialConexoes } from "./MetaSocialConexoes";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MetaSocialConexoes />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  busca = new URLSearchParams();
  apagar.mockClear();
});

describe("MetaSocialConexoes", () => {
  it("sem o app configurado avisa o que falta e esconde o botão", async () => {
    estado = { canais: [], pronto: false, falta: ["META_APP_ID", "META_LOGIN_CONFIG_ID"], podeConectar: true };
    montar();
    expect((await screen.findByTestId("falta-config")).textContent).toContain("META_APP_ID");
    expect(screen.queryByRole("link", { name: "Conectar com Facebook" })).toBeNull();
  });

  it("lista os canais e desconecta", async () => {
    estado = {
      canais: [{ id: "s1", plataforma: "instagram", nome: "Instagram · @gestordaweb", status: "WORKING", conectadoEm: "2026-11-27" }],
      pronto: true,
      falta: [],
      podeConectar: true,
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    montar();
    expect(await screen.findByText("Instagram · @gestordaweb")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conectar com Facebook" }).getAttribute("href")).toBe("/api/v1/channels/meta-social/login");
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(apagar).toHaveBeenCalledWith("/api/v1/channels/meta-social/s1"));
  });

  it("mostra o motivo quando a volta do login falhou", async () => {
    estado = { canais: [], pronto: true, falta: [], podeConectar: true };
    busca = new URLSearchParams("meta=erro&motivo=em_outra_empresa&em_outra_empresa=Gestor");
    montar();
    expect((await screen.findByRole("alert")).textContent).toContain("outra empresa");
  });
});
