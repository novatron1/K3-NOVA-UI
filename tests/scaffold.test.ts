import { describe, expect, it } from "vitest";

describe("project scaffold", () => {
  it("runs component tests in a browser-like document", () => {
    const region = document.createElement("main");
    region.setAttribute("aria-label", "NovaMind");
    document.body.append(region);

    expect(document.querySelector("main"))
      .toHaveAttribute("aria-label", "NovaMind");
  });
});
