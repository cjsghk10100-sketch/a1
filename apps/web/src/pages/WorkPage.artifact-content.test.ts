import { describe, expect, it } from "vitest";

import { buildArtifactContent } from "./WorkPage";

describe("buildArtifactContent", () => {
  it("returns undefined content for none type", () => {
    const res = buildArtifactContent({
      contentType: "none",
      textInput: "x",
      jsonInput: "{\"a\":1}",
      uriInput: "https://x.dev",
    });
    expect(res.errorCode).toBeNull();
    expect(res.content).toBeUndefined();
  });

  it("returns text content as-is", () => {
    const res = buildArtifactContent({
      contentType: "text",
      textInput: " hello ",
      jsonInput: "",
      uriInput: "",
    });
    expect(res.errorCode).toBeNull();
    expect(res.content).toEqual({ type: "text", text: " hello " });
  });

  it("returns default empty object for json type with blank input", () => {
    const res = buildArtifactContent({
      contentType: "json",
      textInput: "",
      jsonInput: "   ",
      uriInput: "",
    });
    expect(res.errorCode).toBeNull();
    expect(res.content).toEqual({ type: "json", json: {} });
  });

  it("parses json content when valid JSON is provided", () => {
    const res = buildArtifactContent({
      contentType: "json",
      textInput: "",
      jsonInput: "{\"ok\":true}",
      uriInput: "",
    });
    expect(res.errorCode).toBeNull();
    expect(res.content).toEqual({ type: "json", json: { ok: true } });
  });

  it("returns invalid_json for malformed json content", () => {
    const res = buildArtifactContent({
      contentType: "json",
      textInput: "",
      jsonInput: "{bad}",
      uriInput: "",
    });
    expect(res.errorCode).toBe("invalid_json");
    expect(res.content).toBeUndefined();
  });

  it("trims uri content", () => {
    const res = buildArtifactContent({
      contentType: "uri",
      textInput: "",
      jsonInput: "",
      uriInput: " https://example.com/x ",
    });
    expect(res.errorCode).toBeNull();
    expect(res.content).toEqual({ type: "uri", uri: "https://example.com/x" });
  });
});
