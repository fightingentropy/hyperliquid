import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FACTOR_MODEL_VERSION } from "../lib/equityResearch";
import ResearchPage from "./ResearchPage";

describe("ResearchPage", () => {
  it("shows the current factor model version in the header badge", () => {
    const html = renderToStaticMarkup(<ResearchPage />);
    expect(html).toContain(`<strong>${FACTOR_MODEL_VERSION}</strong>`);
    expect(html).not.toContain("market-factor-v1");
  });
});
