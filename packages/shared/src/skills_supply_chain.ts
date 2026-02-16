import type { ActorType } from "./events.js";

export const SkillVerificationStatus = {
  Pending: "pending",
  Verified: "verified",
  Quarantined: "quarantined",
} as const;

export type SkillVerificationStatus =
  (typeof SkillVerificationStatus)[keyof typeof SkillVerificationStatus];

export interface SkillPackageManifestV1 {
  required_tools: string[];
  data_access: unknown;
  egress_domains: string[];
  sandbox_required: boolean;
  [key: string]: unknown;
}

export interface SkillPackageRecordV1 {
  skill_package_id: string;
  workspace_id: string;

  skill_id: string;
  version: string;
  hash_sha256: string;
  signature?: string;
  manifest: SkillPackageManifestV1;
  verification_status: SkillVerificationStatus;

  quarantine_reason?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;

  installed_by_type: ActorType;
  installed_by_id: string;
  installed_by_principal_id?: string;
}

