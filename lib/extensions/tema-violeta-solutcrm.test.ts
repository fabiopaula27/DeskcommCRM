import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";
import { checkCompatibility, parseCatalog, parseManifest } from "@/lib/extensions/manifest";

const PACOTE = "extensoes/pacotes/solutcrm/tema-violeta-1.0.0.json";

describe("tema violeta SOLUTCRM", () => {
  const bytes = new Uint8Array(readFileSync(PACOTE));
  const sha = createHash("sha256").update(bytes).digest("hex");

  it("passa no parser e na compatibilidade do host", () => {
    const m = parseManifest(bytes);
    expect(checkCompatibility(m).compatible).toBe(true);
    expect(m.contributions.theme?.palette).toBe("plum");
  });

  it("o arquivo servido em public/packages é byte a byte o pacote", () => {
    expect(new Uint8Array(readFileSync(`public/packages/${sha}.json`))).toEqual(bytes);
  });

  it("o catálogo da instalação aponta o mesmo digest e tamanho", () => {
    const cat = parseCatalog(new Uint8Array(readFileSync("extensoes/catalogo-solutcrm.json")));
    const e = cat.entries.find((x) => x.name === "tema-violeta");
    expect(e?.sha256).toBe(sha);
    expect(e?.byte_length).toBe(bytes.byteLength);
  });

  it("só o caminho exato do pacote é público", () => {
    expect(isPublicPath(`/packages/${sha}.json`)).toBe(true);
    expect(isPublicPath("/packages/outro.json")).toBe(false);
  });
});
