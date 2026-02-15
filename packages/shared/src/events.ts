export const ActorType = {
  Service: "service",
  User: "user",
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const StreamType = {
  Room: "room",
  Thread: "thread",
  Workspace: "workspace",
} as const;

export type StreamType = (typeof StreamType)[keyof typeof StreamType];

export const RedactionLevel = {
  None: "none",
  Partial: "partial",
  Full: "full",
} as const;

export type RedactionLevel = (typeof RedactionLevel)[keyof typeof RedactionLevel];

export interface ActorRefV1 {
  actor_type: ActorType;
  actor_id: string;
}

export interface StreamRefV1 {
  stream_type: StreamType;
  stream_id: string;
  stream_seq?: number;
}

export interface EventEnvelopeV1<TEventType extends string = string, TData = unknown> {
  event_id: string;
  event_type: TEventType;
  event_version: number;
  occurred_at: string; // RFC3339 timestamp

  actor: ActorRefV1;
  stream: StreamRefV1;

  correlation_id: string;
  causation_id?: string;

  data: TData;
  policy_context?: Record<string, unknown>;
  model_context?: Record<string, unknown>;
  display?: Record<string, unknown>;

  redaction_level?: RedactionLevel;
  contains_secrets?: boolean;
}
