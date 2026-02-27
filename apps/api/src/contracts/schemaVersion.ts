export const SCHEMA_VERSION = "2.1" as const;

// Contract policy: output current, input accepts current + previous one.
// Kernel minor changes in PR-1 keep the same schema version baseline (2.1).
// Kernel minor changes in PR-3 also keep SCHEMA_VERSION pinned to 2.1.
// Kernel minor changes in PR-2 also keep SCHEMA_VERSION pinned to 2.1.
// Kernel minor changes in PR-4 also keep SCHEMA_VERSION pinned to 2.1.
export const SUPPORTED_VERSIONS = ["2.0", "2.1"] as const;
export type SupportedSchemaVersion = (typeof SUPPORTED_VERSIONS)[number];

export function isSupportedSchemaVersion(v: unknown): v is SupportedSchemaVersion {
  return typeof v === "string" && SUPPORTED_VERSIONS.includes(v as SupportedSchemaVersion);
}

export function assertSupportedSchemaVersion(v: unknown): asserts v is SupportedSchemaVersion {
  if (typeof v !== "string") throw new Error("schema_version must be a string");
  if (!isSupportedSchemaVersion(v)) {
    throw new Error(`unsupported_version: ${v}`);
  }
}
