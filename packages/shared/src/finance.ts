import type { EventEnvelopeV1 } from "./events.js";

export interface FinanceUsageRecordedDataV1 {
  usage_id: string;
  cost_usd_micros: string | number;
  prompt_tokens: string | number;
  completion_tokens: string | number;
  provider?: string;
  model?: string;
  run_id?: string;
  message_id?: string;
}

export type FinanceUsageRecordedV1 = EventEnvelopeV1<"finance.usage_recorded", FinanceUsageRecordedDataV1>;
export type FinanceEventV1 = FinanceUsageRecordedV1;
