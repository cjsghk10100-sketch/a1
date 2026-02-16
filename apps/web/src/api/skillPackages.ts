import type { SkillPackageRecordV1, SkillVerificationStatus } from "@agentapp/shared";

import { apiGet, apiPost } from "./http";

export async function listSkillPackages(params?: {
  status?: SkillVerificationStatus;
  skill_id?: string;
  limit?: number;
}): Promise<SkillPackageRecordV1[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.skill_id) qs.set("skill_id", params.skill_id);
  if (params?.limit) qs.set("limit", String(params.limit));

  const url = `/v1/skills/packages${qs.size ? `?${qs.toString()}` : ""}`;
  const res = await apiGet<{ packages: SkillPackageRecordV1[] }>(url);
  return res.packages;
}

export async function verifySkillPackage(
  skill_package_id: string,
): Promise<{ ok: boolean; already_verified?: boolean; verification_status: SkillVerificationStatus }> {
  return await apiPost<{ ok: boolean; already_verified?: boolean; verification_status: SkillVerificationStatus }>(
    `/v1/skills/packages/${encodeURIComponent(skill_package_id)}/verify`,
    {},
  );
}

export async function quarantineSkillPackage(
  skill_package_id: string,
  reason: string,
): Promise<{ ok: boolean; already_quarantined?: boolean; verification_status: SkillVerificationStatus }> {
  return await apiPost<{
    ok: boolean;
    already_quarantined?: boolean;
    verification_status: SkillVerificationStatus;
  }>(`/v1/skills/packages/${encodeURIComponent(skill_package_id)}/quarantine`, { reason });
}

