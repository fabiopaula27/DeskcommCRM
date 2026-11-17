import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { ConnectionsClient } from "./ConnectionsClient";

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: h.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));

const base = {
  phone_number: null,
  status_reason: null,
  last_health_check_at: null,
  last_status_change_at: null,
  daily_message_limit: 100,
  is_warmup_complete: null,
  created_at: "2026-01-01T00:00:00Z",
};

afterEach(cleanup);

it("não desenha na grade antiga um canal do servidor por QR próprio", async () => {
  h.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/channel-sessions") {
      return {
        data: [
          { ...base, id: "a", provider: "evolution", display_name: "Canal Evo", status: "WORKING" },
          { ...base, id: "b", display_name: "Canal Oficial", status: "WORKING" },
        ],
      };
    }
    return { data: { channels: [], items: [] } };
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConnectionsClient wahaConfigured />
    </QueryClientProvider>,
  );
  await screen.findByText("Canal Oficial");
  expect(screen.queryByText("Canal Evo")).toBeNull();
});
