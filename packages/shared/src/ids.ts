import { ulid } from "ulid";

export type ApprovalId = `appr_${string}`;
export type ArtifactId = `art_${string}`;
export type IncidentId = `inc_${string}`;
export type MessageId = `msg_${string}`;
export type RoomId = `room_${string}`;
export type RunId = `run_${string}`;
export type StepId = `step_${string}`;
export type ToolCallId = `tc_${string}`;
export type ThreadId = `th_${string}`;
export type WorkspaceId = `ws_${string}`;

function withPrefix<T extends string>(prefix: T): `${T}${string}` {
  return `${prefix}${ulid()}` as `${T}${string}`;
}

export function newApprovalId(): ApprovalId {
  return withPrefix("appr_") as ApprovalId;
}

export function newArtifactId(): ArtifactId {
  return withPrefix("art_") as ArtifactId;
}

export function newIncidentId(): IncidentId {
  return withPrefix("inc_") as IncidentId;
}

export function newMessageId(): MessageId {
  return withPrefix("msg_") as MessageId;
}

export function newRoomId(): RoomId {
  return withPrefix("room_") as RoomId;
}

export function newRunId(): RunId {
  return withPrefix("run_") as RunId;
}

export function newStepId(): StepId {
  return withPrefix("step_") as StepId;
}

export function newToolCallId(): ToolCallId {
  return withPrefix("tc_") as ToolCallId;
}

export function newThreadId(): ThreadId {
  return withPrefix("th_") as ThreadId;
}

export function newWorkspaceId(): WorkspaceId {
  return withPrefix("ws_") as WorkspaceId;
}
