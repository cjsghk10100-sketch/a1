import { describe, expect, it } from "vitest";

import { parseRunTagsCsv } from "./WorkPage";

describe("parseRunTagsCsv", () => {
  it("returns undefined for blank input", () => {
    expect(parseRunTagsCsv("   ")).toBeUndefined();
  });

  it("splits and trims CSV values", () => {
    expect(parseRunTagsCsv("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("filters empty entries", () => {
    expect(parseRunTagsCsv("a,, ,b,")).toEqual(["a", "b"]);
  });

  it("preserves order and duplicates", () => {
    expect(parseRunTagsCsv("alpha,beta,alpha")).toEqual(["alpha", "beta", "alpha"]);
  });
});
