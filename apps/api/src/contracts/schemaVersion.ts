export const SCHEMA_VERSION = "2.1" as const;

// pinned to current only
export const SUPPORTED_VERSIONS = ["2.1"] as const;
export type SupportedSchemaVersion = (typeof SUPPORTED_VERSIONS)[number];

export function assertSupportedSchemaVersion(v: unknown): asserts v is SupportedSchemaVersion {
  if (typeof v !== "string") throw new Error("schema_version must be a string");
  if (!SUPPORTED_VERSIONS.includes(v as SupportedSchemaVersion)) {
    throw new Error(`unsupported_version: ${v}`);
  }
}
