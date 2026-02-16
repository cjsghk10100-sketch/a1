import type { SkillPackageManifestV1, SkillVerificationStatus } from "./skills_supply_chain.js";

export interface AgentRecordV1 {
  agent_id: string;
  principal_id: string;
  display_name: string;
  created_at: string;
  revoked_at?: string;
}

export interface AgentRegisterRequestV1 {
  display_name: string;
}

export interface AgentRegisterResponseV1 {
  agent_id: string;
  principal_id: string;
}

export interface AgentSkillImportItemV1 {
  skill_id: string;
  version: string;
  hash_sha256: string;
  manifest?: SkillPackageManifestV1;
  signature?: string;
}

export interface AgentSkillImportRequestV1 {
  packages: AgentSkillImportItemV1[];
}

export interface AgentSkillImportSummaryV1 {
  total: number;
  verified: number;
  pending: number;
  quarantined: number;
}

export interface AgentSkillImportResponseV1 {
  summary: AgentSkillImportSummaryV1;
  items: Array<{
    skill_id: string;
    version: string;
    status: SkillVerificationStatus;
    skill_package_id: string;
  }>;
}

