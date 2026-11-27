import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Anotacao } from "@/lib/contatos/anotacoes";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (k: string) => k }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useUser: () => ({ id: "u1" }) }));
vi.mock("@/app/app/tasks/_components/FormularioDeTarefa", () => ({ FormularioDeTarefa: () => null }));
vi.mock("@/hooks/contacts/useUpdateContact", () => ({ useUpdateContact: () => ({ mutate: vi.fn(), isPending: false }) }));

const mut = () => ({ mutate: vi.fn(), isPending: false });
let anotacoes: Anotacao[] = [];
vi.mock("@/hooks/contacts/useAnotacoes", () => ({
  useAnotacoes: () => ({
    lista: { data: { disponivel: true, anotacoes }, isLoading: false },
    criarTexto: mut(),
    enviarAudio: mut(),
    usarAudioDaConversa: mut(),
    editar: mut(),
    apagar: mut(),
    transcreverDeNovo: mut(),
  }),
  useAudiosDaConversa: () => ({ data: [], isLoading: false }),
  useResumoDoLead: () => mut(),
}));
vi.mock("@/hooks/tasks/useTasks", () => ({
  useTasks: () => ({
    tarefas: [{ id: "t1", title: "Ligar de volta", status: "pending", due_date: null, created_at: "2026-11-27T13:05:00Z" }],
    criarTarefa: vi.fn(),
  }),
}));

import { AbaAnotacoes } from "./AbaAnotacoes";

const base: Anotacao = {
  id: "a1",
  kind: "text",
  body: "Prefere contato depois das 18h.",
  audioUrl: null,
  duracao: null,
  status: "none",
  daConversa: false,
  autor: { id: "u1", nome: "Junior" },
  criadaEm: "2026-11-27T17:32:00Z",
  editadaEm: null,
  podeEditar: true,
};

function abrir(podeEscrever = true) {
  return render(<AbaAnotacoes contactId="c1" podeEscrever={podeEscrever} campoResumo={null} camposAtuais={{}} />);
}

describe("aba Anotações", () => {
  it("mostra anotações e tarefas na mesma linha do tempo, mais recentes primeiro", () => {
    anotacoes = [base, { ...base, id: "a0", body: "Mais antiga", criadaEm: "2026-11-26T10:00:00Z" }];
    abrir();
    const textos = screen.getAllByTestId(/item-(anotacao|tarefa)/).map((e) => e.textContent ?? "");
    expect(textos[0]).toContain("Prefere contato");
    expect(textos[1]).toContain("Ligar de volta");
    expect(textos[2]).toContain("Mais antiga");
  });

  it("áudio sem transcrição avisa e oferece tentar de novo", () => {
    anotacoes = [{ ...base, kind: "audio", body: null, status: "unavailable", audioUrl: "https://x/a.webm" }];
    abrir();
    expect(screen.getByTestId("sem-transcricao").textContent).toMatch(/Transcrição indisponível/);
    expect(screen.getByRole("button", { name: "Tentar transcrever de novo" })).toBeTruthy();
  });

  it("editar e apagar só aparecem para quem pode mexer", () => {
    anotacoes = [{ ...base, podeEditar: false }];
    abrir();
    expect(screen.queryByRole("button", { name: "Editar anotação" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apagar anotação" })).toBeNull();
  });

  it("quem só vê não tem os botões de registrar", () => {
    anotacoes = [];
    abrir(false);
    expect(screen.queryByRole("button", { name: /Gravar áudio/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nova tarefa/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Gerar resumo" })).toBeTruthy();
  });
});
