import type { SkillPackageManifestV1, SkillVerificationStatus } from "./skills_supply_chain.js";
import type { ActorType } from "./events.js";

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

export interface AgentListResponseV1 {
  agents: AgentRecordV1[];
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

export interface AgentSkillReviewPendingRequestV1 {
  actor_type?: ActorType;
  actor_id?: string;
  principal_id?: string;
  correlation_id?: string;
}

export interface AgentSkillReviewPendingResponseV1 {
  summary: {
    total: number;
    verified: number;
    quarantined: number;
  };
  items: Array<{
    skill_package_id: string;
    skill_id: string;
    version: string;
    status: SkillVerificationStatus;
    reason?: string;
  }>;
}

export interface AgentSkillAssessImportedRequestV1 {
  limit?: number;
  only_unassessed?: boolean;
  actor_type?: ActorType;
  actor_id?: string;
  actor_principal_id?: string;
  correlation_id?: string;
}

export interface AgentSkillAssessImportedResponseV1 {
  summary: {
    total_candidates: number;
    assessed: number;
    skipped: number;
  };
  items: Array<{
    skill_id: string;
    skill_package_id: string;
    status: "passed";
    assessment_id?: string;
    skipped_reason?: "already_assessed";
  }>;
}

export interface AgentSkillCertifyImportedRequestV1 {
  actor_type?: ActorType;
  actor_id?: string;
  principal_id?: string;
  actor_principal_id?: string;
  correlation_id?: string;
  limit?: number;
  only_unassessed?: boolean;
}

export interface AgentSkillCertifyImportedResponseV1 {
  review: AgentSkillReviewPendingResponseV1;
  assess: AgentSkillAssessImportedResponseV1;
}

export interface AgentSkillImportCertifyRequestV1 {
  packages: AgentSkillImportItemV1[];
  actor_type?: ActorType;
  actor_id?: string;
  principal_id?: string;
  actor_principal_id?: string;
  correlation_id?: string;
  limit?: number;
  only_unassessed?: boolean;
}

export interface AgentSkillImportCertifyResponseV1 {
  import: AgentSkillImportResponseV1;
  certify: AgentSkillCertifyImportedResponseV1;
}

export interface AgentSkillOnboardingSummaryV1 {
  total_linked: number;
  verified: number;
  verified_skills: number;
  pending: number;
  quarantined: number;
  verified_assessed: number;
  verified_unassessed: number;
}

export interface AgentSkillOnboardingStatusResponseV1 {
  summary: AgentSkillOnboardingSummaryV1;
}

export interface AgentSkillOnboardingStatusItemV1 {
  agent_id: string;
  summary: AgentSkillOnboardingSummaryV1;
}

export interface AgentSkillOnboardingStatusListResponseV1 {
  items: AgentSkillOnboardingStatusItemV1[];
}
