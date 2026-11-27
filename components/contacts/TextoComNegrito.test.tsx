import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TextoComNegrito } from "./TextoComNegrito";

describe("TextoComNegrito", () => {
  it("troca **x** por negrito, sem asteriscos, e quebra linha antes de cada título seguinte", () => {
    const { container } = render(<TextoComNegrito texto="**Quem é** Sérgio. **O que quer** Divulgação." />);
    expect(container.textContent).not.toContain("*");
    expect([...container.querySelectorAll("strong")].map((s) => s.textContent)).toEqual(["Quem é", "O que quer"]);
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("não interpreta HTML", () => {
    const { container } = render(<TextoComNegrito texto="<b>oi</b>" />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>oi</b>");
  });
});
