import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CanalEvolutionClient } from "./CanalEvolutionClient";

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: h.get, post: h.post, delete: h.del } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// O controle de acesso da IA tem teste próprio; aqui só importa que ele é
// montado para cada número, com o id da conexão.
vi.mock("./ChannelAiAccess", () => ({
  ChannelAiAccess: ({ channelId }: { channelId: string }) => <div data-testid="acesso-ia">{channelId}</div>,
}));

let sessoes: Array<Record<string, unknown>> = [];
let qrAtual = "QR1";

function sessao(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "s1",
    provider: "evolution",
    status,
    status_reason: null,
    display_name: "Loja",
    phone_number: null,
    ...extra,
  };
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessoes = [];
  qrAtual = "QR1";
  h.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/channel-sessions") return { data: sessoes };
    if (url === "/api/v1/channels/evolution/s1/qr") return { data: { qr_base64: qrAtual, pairing_code: null } };
    throw new Error(`GET inesperado ${url}`);
  });
  h.post.mockImplementation(async (url: string) => {
    if (url === "/api/v1/channels/evolution") {
      sessoes = [sessao("SCAN_QR_CODE")];
      return { data: { channel_session_id: "s1", qr_base64: "QR0" } };
    }
    if (url === "/api/v1/channels/evolution/s1/reconnect") return { data: { channel_session_id: "s1", qr_base64: "QRR" } };
    throw new Error(`POST inesperado ${url}`);
  });
  h.del.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("sem configuração do servidor não mostra o botão", async () => {
  render(<CanalEvolutionClient isConfigured={false} />);
  await avancar(0);
  expect(screen.queryByRole("button", { name: "Conectar via Evolution" })).toBeNull();
});

it("conectar mostra o QR e atualiza pela rota /qr a cada 5 s até conectar", async () => {
  render(<CanalEvolutionClient isConfigured />);
  await avancar(0);
  fireEvent.click(screen.getByRole("button", { name: "Conectar via Evolution" }));
  await avancar(0);
  expect(h.post).toHaveBeenCalledWith(
    "/api/v1/channels/evolution",
    expect.anything(),
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  );
  const img = () => screen.getByAltText("QR Code para conectar WhatsApp") as HTMLImageElement;
  expect(img().src).toContain("QR0");

  qrAtual = "QR2";
  await avancar(5000);
  expect(img().src).toContain("QR2");

  sessoes = [sessao("WORKING")];
  await avancar(5000);
  expect(screen.getByText("Conectado!")).toBeTruthy();
  const chamadas = h.get.mock.calls.length;
  await avancar(20000);
  expect(h.get.mock.calls.length).toBe(chamadas);
});

it("resposta idempotente sem QR cai para a rota /qr", async () => {
  h.post.mockImplementation(async () => {
    sessoes = [sessao("SCAN_QR_CODE")];
    return { data: { channel_session_id: "s1", qr_base64: null } };
  });
  render(<CanalEvolutionClient isConfigured />);
  await avancar(0);
  fireEvent.click(screen.getByRole("button", { name: "Conectar via Evolution" }));
  await avancar(0);
  expect((screen.getByAltText("QR Code para conectar WhatsApp") as HTMLImageElement).src).toContain("QR1");
});

it("numero_em_uso mostra a mensagem em português", async () => {
  sessoes = [sessao("FAILED", { status_reason: "numero_em_uso" })];
  render(<CanalEvolutionClient isConfigured />);
  await avancar(0);
  expect(screen.getByText("Este número já está conectado em outra conexão.")).toBeTruthy();
});

it("cada número tem o controle de acesso da IA (modo de teste / aberta ao público)", async () => {
  sessoes = [sessao("WORKING")];
  render(<CanalEvolutionClient isConfigured />);
  await avancar(0);
  expect(screen.getByTestId("acesso-ia").textContent).toBe("s1");
});

it("Reconectar e Desconectar chamam as rotas", async () => {
  sessoes = [sessao("STOPPED")];
  render(<CanalEvolutionClient isConfigured />);
  await avancar(0);
  fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
  await avancar(0);
  expect(h.post).toHaveBeenCalledWith("/api/v1/channels/evolution/s1/reconnect", {});
  fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
  await avancar(0);
  expect(h.del).toHaveBeenCalledWith("/api/v1/channel-sessions/s1");
});

it("para de consultar ao desmontar", async () => {
  render(<CanalEvolutionClient isConfigured />);
  await avancar(0);
  fireEvent.click(screen.getByRole("button", { name: "Conectar via Evolution" }));
  await avancar(0);
  cleanup();
  const chamadas = h.get.mock.calls.length;
  await avancar(20000);
  expect(h.get.mock.calls.length).toBe(chamadas);
});

it("STOPPED visto logo após Reconectar não encerra a consulta; depois de 30 s encerra", async () => {
  sessoes = [sessao("STOPPED")];
  render(<CanalEvolutionClient isConfigured />);
  await avancar(0);
  fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
  await avancar(0);
  await avancar(5000);
  expect(screen.getByAltText("QR Code para conectar WhatsApp")).toBeTruthy();
  sessoes = [sessao("SCAN_QR_CODE")];
  qrAtual = "QR9";
  await avancar(5000);
  expect((screen.getByAltText("QR Code para conectar WhatsApp") as HTMLImageElement).src).toContain("QR9");
  sessoes = [sessao("STOPPED")];
  await avancar(35000);
  expect(screen.queryByAltText("QR Code para conectar WhatsApp")).toBeNull();
});
