import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const get = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } }));

import { AbaEnvioAgendado } from "./AbaEnvioAgendado";

function renderizar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AbaEnvioAgendado />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

describe("AbaEnvioAgendado", () => {
  it("salva e-mails e telefones com o número escolhido", async () => {
    get.mockResolvedValue({
      data: {
        disponivel: true,
        agendamento: null,
        canais: [{ id: "11111111-1111-4111-8111-111111111111", nome: "Principal", telefone: "556892822725", conectado: true }],
      },
    });
    put.mockResolvedValue({ data: { salvo: true } });
    renderizar();
    await screen.findByText("Envio agendado de relatórios");

    fireEvent.change(screen.getByLabelText("E-mail 1"), { target: { value: "gestor@empresa.com" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar telefone" }));
    fireEvent.change(screen.getByLabelText("Telefone 1"), { target: { value: "+5516999990000" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![1]).toMatchObject({
      ativo: true,
      frequencia: "diario",
      horario: "08:00",
      emails: ["gestor@empresa.com"],
      telefones: ["+5516999990000"],
      channel_session_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("mostra o erro do último envio", async () => {
    get.mockResolvedValue({
      data: {
        disponivel: true,
        agendamento: {
          ativo: true, frequencia: "semanal", horario: "09:30:00", emails: ["a@x.com"], telefones: [],
          channel_session_id: null, ultimo_envio_em: null, ultimo_erro: "E-mail: not_configured", ultimo_periodo: null,
        },
        canais: [],
      },
    });
    renderizar();
    expect(await screen.findByText(/E-mail: not_configured/)).toBeTruthy();
  });

  it("telefone em formato errado não salva", async () => {
    get.mockResolvedValue({ data: { disponivel: true, agendamento: null, canais: [] } });
    renderizar();
    await screen.findByText("Envio agendado de relatórios");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar telefone" }));
    fireEvent.change(screen.getByLabelText("Telefone 1"), { target: { value: "16 99999" } });
    expect((screen.getByRole("button", { name: "Salvar agendamento" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
