import { describe, expect, it } from "vitest";

import { parseRunCompletePayload, parseRunFailPayload } from "./WorkPage";

describe("parseRunCompletePayload", () => {
  it("returns trimmed summary when only summary is provided", () => {
    const res = parseRunCompletePayload({
      summaryInput: "  done  ",
      outputJsonInput: "",
    });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({ summary: "done" });
  });

  it("parses JSON output when provided", () => {
    const res = parseRunCompletePayload({
      summaryInput: "",
      outputJsonInput: "{\"ok\":true}",
    });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({ output: { ok: true } });
  });

  it("returns invalid_json on malformed output JSON", () => {
    const res = parseRunCompletePayload({
      summaryInput: "done",
      outputJsonInput: "{bad}",
    });
    expect(res.errorCode).toBe("invalid_json");
    expect(res.payload).toEqual({ summary: "done" });
  });
});

describe("parseRunFailPayload", () => {
  it("returns trimmed message when only message is provided", () => {
    const res = parseRunFailPayload({
      messageInput: "  failed  ",
      errorJsonInput: "",
    });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({ message: "failed" });
  });

  it("parses JSON error when provided", () => {
    const res = parseRunFailPayload({
      messageInput: "",
      errorJsonInput: "{\"reason\":\"timeout\"}",
    });
    expect(res.errorCode).toBeNull();
    expect(res.payload).toEqual({ error: { reason: "timeout" } });
  });

  it("returns invalid_json on malformed error JSON", () => {
    const res = parseRunFailPayload({
      messageInput: "failed",
      errorJsonInput: "{bad}",
    });
    expect(res.errorCode).toBe("invalid_json");
    expect(res.payload).toEqual({ message: "failed" });
  });
});
