import type { EventEnvelopeV1 } from "./events.js";
import type { ArtifactId } from "./ids.js";

export const ArtifactContentType = {
  None: "none",
  Text: "text",
  Json: "json",
  Uri: "uri",
} as const;

export type ArtifactContentType = (typeof ArtifactContentType)[keyof typeof ArtifactContentType];

export interface ArtifactContentV1 {
  type: ArtifactContentType;
  text?: string;
  json?: Record<string, unknown>;
  uri?: string;
}

export interface ArtifactCreatedDataV1 {
  artifact_id: ArtifactId;
  kind: string;
  title?: string;
  mime_type?: string;
  size_bytes?: number;
  sha256?: string;
  content?: ArtifactContentV1;
  metadata?: Record<string, unknown>;
}

export type ArtifactCreatedV1 = EventEnvelopeV1<"artifact.created", ArtifactCreatedDataV1>;
export type ArtifactEventV1 = ArtifactCreatedV1;

