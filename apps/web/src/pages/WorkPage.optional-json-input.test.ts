import { describe, expect, it } from "vitest";

import { parseOptionalJsonInput } from "./WorkPage";

describe("parseOptionalJsonInput", () => {
  it("returns undefined value for blank input", () => {
    const res = parseOptionalJsonInput("   ");
    expect(res.errorCode).toBeNull();
    expect(res.value).toBeUndefined();
  });

  it("parses valid JSON input", () => {
    const res = parseOptionalJsonInput("{\"a\":1}");
    expect(res.errorCode).toBeNull();
    expect(res.value).toEqual({ a: 1 });
  });

  it("parses valid JSON input with surrounding whitespace", () => {
    const res = parseOptionalJsonInput("  [1,2,3]  ");
    expect(res.errorCode).toBeNull();
    expect(res.value).toEqual([1, 2, 3]);
  });

  it("returns invalid_json on malformed input", () => {
    const res = parseOptionalJsonInput("{bad}");
    expect(res.errorCode).toBe("invalid_json");
    expect(res.value).toBeUndefined();
  });
});
