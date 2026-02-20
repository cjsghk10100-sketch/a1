import { apiGet } from "./http";

export interface ActionRegistryRow {
  action_type: string;
  reversible: boolean;
  zone_required: string;
  requires_pre_approval: boolean;
  post_review_required: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export async function listActionRegistry(): Promise<ActionRegistryRow[]> {
  const res = await apiGet<{ actions: ActionRegistryRow[] }>("/v1/action-registry");
  return res.actions;
}
