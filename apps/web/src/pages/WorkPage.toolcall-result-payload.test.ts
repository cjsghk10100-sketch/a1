import { describe, expect, it } from "vitest";

import { parseToolCallFailPayload, parseToolCallSucceedPayload } from "./WorkPage";

describe("parseToolCallSucceedPayload", () => {
  it("returns empty payload when output JSON is empty", () => {
    const res = parseToolCallSucceedPayload({ outputJsonInput: "" });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({});
  });

  it("parses output JSON", () => {
    const res = parseToolCallSucceedPayload({ outputJsonInput: "{\"ok\":true}" });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({ output: { ok: true } });
  });

  it("returns invalid_json when output JSON is malformed", () => {
    const res = parseToolCallSucceedPayload({ outputJsonInput: "{bad}" });
    expect(res.errorCode).toBe("invalid_json");
    expect(res.payload).toEqual({});
  });
});

describe("parseToolCallFailPayload", () => {
  it("returns trimmed message when only message is provided", () => {
    const res = parseToolCallFailPayload({
      messageInput: "  failed  ",
      errorJsonInput: "",
    });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({ message: "failed" });
  });

  it("parses error JSON when provided", () => {
    const res = parseToolCallFailPayload({
      messageInput: "",
      errorJsonInput: "{\"reason\":\"timeout\"}",
    });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({ error: { reason: "timeout" } });
  });

  it("returns invalid_json when error JSON is malformed", () => {
    const res = parseToolCallFailPayload({
      messageInput: "failed",
      errorJsonInput: "{bad}",
    });
    expect(res.errorCode).toBe("invalid_json");
    expect(res.payload).toEqual({ message: "failed" });
  });
});
