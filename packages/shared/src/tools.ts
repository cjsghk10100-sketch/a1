import type { EventEnvelopeV1 } from "./events.js";
import type { ToolCallId } from "./ids.js";

export const ToolCallStatus = {
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
} as const;

export type ToolCallStatus = (typeof ToolCallStatus)[keyof typeof ToolCallStatus];

export interface ToolInvokedDataV1 {
  tool_call_id: ToolCallId;
  tool_name: string;
  title?: string;
  input?: Record<string, unknown>;
}

export interface ToolSucceededDataV1 {
  tool_call_id: ToolCallId;
  output?: Record<string, unknown>;
}

export interface ToolFailedDataV1 {
  tool_call_id: ToolCallId;
  error?: Record<string, unknown>;
  message?: string;
}

export type ToolInvokedV1 = EventEnvelopeV1<"tool.invoked", ToolInvokedDataV1>;
export type ToolSucceededV1 = EventEnvelopeV1<"tool.succeeded", ToolSucceededDataV1>;
export type ToolFailedV1 = EventEnvelopeV1<"tool.failed", ToolFailedDataV1>;

export type ToolEventV1 = ToolInvokedV1 | ToolSucceededV1 | ToolFailedV1;

