import type { SkillPackageManifestV1, SkillVerificationStatus } from "./skills_supply_chain.js";

export interface AgentRecordV1 {
  agent_id: string;
  principal_id: string;
  display_name: string;
  created_at: string;
  revoked_at?: string;
  quarantined_at?: string;
  quarantine_reason?: string;
}

export interface AgentRegisterRequestV1 {
  display_name: string;
}

export interface AgentRegisterResponseV1 {
  agent_id: string;
  principal_id: string;
}

export interface AgentGetResponseV1 {
  agent: AgentRecordV1;
}

export interface AgentQuarantineRequestV1 {
  quarantine_reason?: string;
}

export interface AgentQuarantineResponseV1 {
  agent_id: string;
  principal_id: string;
  quarantined_at: string | null;
  quarantine_reason?: string;
}

export interface AgentUnquarantineResponseV1 {
  agent_id: string;
  principal_id: string;
  quarantined_at: string | null;
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
