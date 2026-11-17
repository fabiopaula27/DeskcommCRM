import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClientModule from "../evolution/client";

const enviarTexto = vi.fn();
const enviarMidia = vi.fn();
const estado = vi.fn();
let cliente: unknown = null;

vi.mock("../evolution/client", async () => {
  const actual = await vi.importActual<typeof ClientModule>("../evolution/client");
  return { ...actual, createEvolutionClient: () => cliente };
});

import { EvolutionError } from "../evolution/client";
import { evolutionAdapter } from "./evolution";

const base = { organizationId: "org", sessionRef: "dc-abc", to: "5511999990001" };

beforeEach(() => {
  enviarTexto.mockReset();
  enviarMidia.mockReset();
  estado.mockReset();
  cliente = { enviarTexto, enviarMidia, estado };
});

describe("evolutionAdapter.resolveRecipient", () => {
  const r = (phoneNumber: string | null, isGroup = false) =>
    evolutionAdapter.resolveRecipient({
      isGroup,
      groupChatId: isGroup ? "1@g.us" : null,
      phoneNumber,
      waIdentity: null,
    });
  it("so digitos, sem @c.us", () => {
    expect(r("+55 (11) 99999-0001")).toBe("5511999990001");
  });
  it("normaliza DDI 55 quando ausente", () => {
    expect(r("11999990001")).toBe("5511999990001");
  });
  it("sem telefone ou grupo -> null", () => {
    expect(r(null)).toBeNull();
    expect(r("5511999990001", true)).toBeNull();
  });
});

describe("evolutionAdapter.send", () => {
  it("texto: chama enviarTexto com sessionRef e devolve key.id como externalId", async () => {
    enviarTexto.mockResolvedValue({ externalId: "3EB0KEYID" });
    const r = await evolutionAdapter.send({ ...base, kind: "text", body: "oi" } as never);
    expect(enviarTexto).toHaveBeenCalledWith({ nome: "dc-abc", numero: "5511999990001", texto: "oi" });
    expect(r).toEqual({ externalId: "3EB0KEYID" });
  });

  it.each(["image", "video", "audio", "document"] as const)("midia %s", async (kind) => {
    enviarMidia.mockResolvedValue({ externalId: "M1" });
    const r = await evolutionAdapter.send({
      ...base,
      kind,
      media: { url: "https://x/f", mime: "m/x", filename: "f.bin", caption: "leg" },
    } as never);
    expect(enviarMidia).toHaveBeenCalledWith({
      nome: "dc-abc",
      numero: "5511999990001",
      tipo: kind,
      base64OuUrl: "https://x/f",
      mimetype: "m/x",
      nomeArquivo: "f.bin",
      legenda: "leg",
    });
    expect(r).toEqual({ externalId: "M1" });
  });

  it("sem configuracao -> rejeita com evolution_not_configured", async () => {
    cliente = null;
    await expect(evolutionAdapter.send({ ...base, kind: "text", body: "oi" } as never)).rejects.toThrow(
      "evolution_not_configured",
    );
  });

  it("servidor fora -> rejeita com o codigo, sem apikey", async () => {
    enviarTexto.mockRejectedValue(new EvolutionError("indisponivel", "Evolution API inacessivel (POST /x)"));
    const err = await evolutionAdapter
      .send({ ...base, kind: "text", body: "oi" } as never)
      .catch((e: Error) => e);
    expect((err as Error).message).toBe("evolution_indisponivel");
  });

  it("chama beforeSend antes do transporte", async () => {
    enviarTexto.mockResolvedValue({ externalId: "K" });
    const ordem: string[] = [];
    enviarTexto.mockImplementation(async () => {
      ordem.push("send");
      return { externalId: "K" };
    });
    await evolutionAdapter.send({
      ...base,
      kind: "text",
      body: "oi",
      beforeSend: async () => void ordem.push("before"),
    } as never);
    expect(ordem).toEqual(["before", "send"]);
  });
});

describe("evolutionAdapter.checkHealth", () => {
  it("open -> conectado", async () => {
    estado.mockResolvedValue("open");
    await expect(evolutionAdapter.checkHealth!({ organizationId: "org", sessionRef: "dc-abc" })).resolves.toEqual({
      reachable: true,
      status: "WORKING",
      detail: null,
    });
  });
  it("connecting -> iniciando", async () => {
    estado.mockResolvedValue("connecting");
    const h = await evolutionAdapter.checkHealth!({ organizationId: "org", sessionRef: "dc-abc" });
    expect(h.status).toBe("STARTING");
  });
  it.each(["close", "inexistente"] as const)("%s -> desconectado", async (s) => {
    estado.mockResolvedValue(s);
    const h = await evolutionAdapter.checkHealth!({ organizationId: "org", sessionRef: "dc-abc" });
    expect(h.reachable).toBe(true);
    expect(h.status).toBe("STOPPED");
  });
  it("servidor fora -> inalcancavel", async () => {
    estado.mockRejectedValue(new EvolutionError("indisponivel", "x"));
    const h = await evolutionAdapter.checkHealth!({ organizationId: "org", sessionRef: "dc-abc" });
    expect(h).toEqual({ reachable: false, status: null, detail: "evolution_indisponivel" });
  });
});
