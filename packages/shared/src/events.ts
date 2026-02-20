export const ActorType = {
  Service: "service",
  User: "user",
  Agent: "agent",
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const Zone = {
  Sandbox: "sandbox",
  Supervised: "supervised",
  HighStakes: "high_stakes",
} as const;

export type Zone = (typeof Zone)[keyof typeof Zone];

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

  workspace_id: string;
  mission_id?: string;
  room_id?: string;
  thread_id?: string;
  run_id?: string;
  step_id?: string;

  actor: ActorRefV1;
  actor_principal_id?: string;
  zone?: Zone;
  stream: StreamRefV1;

  correlation_id: string;
  causation_id?: string;

  data: TData;
  policy_context?: Record<string, unknown>;
  model_context?: Record<string, unknown>;
  display?: Record<string, unknown>;

  redaction_level?: RedactionLevel;
  contains_secrets?: boolean;

  idempotency_key?: string;
}

export interface EventRedactedDataV1 {
  target_event_id: string;
  reason?: string;
  intended_redaction_level: RedactionLevel;
}

export type EventRedactedEventV1 = EventEnvelopeV1<"event.redacted", EventRedactedDataV1>;
