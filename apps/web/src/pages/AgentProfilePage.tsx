import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type {
  AgentRecordV1,
  AgentSkillAssessImportedResponseV1,
  AgentSkillCertifyImportedResponseV1,
  AgentSkillImportResponseV1,
  AgentSkillOnboardingStatusResponseV1,
  AutonomyApproveResponseV1,
  AutonomyRecommendationV1,
  SkillPackageRecordV1,
  SkillVerificationStatus,
} from "@agentapp/shared";

import type {
  AgentApprovalRecommendationRow,
  AgentSkillAssessmentRow,
  AgentApprovalRecommendationTargetRow,
  AgentSkillRow,
  AgentTrustRow,
  ApprovalRecommendationBasisCode,
  ApprovalRecommendationTarget,
  CapabilityTokenRow,
  ConstraintLearnedRow,
  DailyAgentSnapshotRow,
  MistakeRepeatedRow,
  RegisteredAgent,
} from "../api/agents";
import {
  assessImportedAgentSkills,
  approveAutonomyUpgrade,
  certifyImportedAgentSkills,
  getAgent,
  getAgentApprovalRecommendation,
  getAgentSkillOnboardingStatus,
  getAgentTrust,
  importAndCertifyAgentSkills,
  importAgentSkills,
  listAgentSkills,
  listAgentSkillAssessments,
  listAgentSnapshots,
  listCapabilityTokens,
  listConstraintLearnedEvents,
  listMistakeRepeatedEvents,
  listRegisteredAgents,
  quarantineAgent,
  reviewPendingAgentSkills,
  recommendAutonomyUpgrade,
  registerAgent,
  unquarantineAgent,
} from "../api/agents";
import { listSkillPackages, quarantineSkillPackage, verifySkillPackage } from "../api/skillPackages";
import { ApiError } from "../api/http";
import { ensureLegacyPrincipal } from "../api/principals";
import { JsonView } from "../components/JsonView";
import type { ActionRegistryRow } from "../api/actionRegistry";
import { listActionRegistry } from "../api/actionRegistry";
import type { EventRow } from "../api/events";
import { listEvents } from "../api/events";

type TabKey = "permissions" | "growth";

function toErrorCode(e: unknown): string {
  if (e instanceof ApiError) return String(e.status);
  return "unknown";
}

function formatTimestamp(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatPct01(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `${pct}%`;
}

function formatPct01OrDash(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPct01(value);
}

function formatSigned(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "0";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function formatSignedPct01(value: number): string {
  if (!Number.isFinite(value)) return "0.0pp";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}pp`;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(total)) return null;
  return total / values.length;
}

function growthRate(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  if (Math.abs(previous) < 1e-9) return null;
  return (current - previous) / Math.abs(previous);
}

function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.0%";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function onboardingWorkCount(status: AgentSkillOnboardingStatusResponseV1): number {
  return Math.max(0, status.summary.pending) + Math.max(0, status.summary.verified_unassessed);
}

function isTokenActive(token: CapabilityTokenRow): boolean {
  if (token.revoked_at) return false;
  if (token.valid_until) {
    const t = new Date(token.valid_until).getTime();
    if (Number.isFinite(t) && t <= Date.now()) return false;
  }
  return true;
}

function skillPackageStatusPill(status: SkillVerificationStatus): string {
  if (status === "verified") return "statusPill statusApproved";
  if (status === "quarantined") return "statusPill statusDenied";
  return "statusPill statusHeld";
}

function assessmentStatusPill(status: "started" | "passed" | "failed"): string {
  if (status === "passed") return "statusPill statusApproved";
  if (status === "failed") return "statusPill statusDenied";
  return "statusPill statusHeld";
}

type PermissionState = "allowed" | "limited" | "blocked";
type ZoneState = "active" | "limited" | "blocked";
type TrendState = "up" | "down" | "flat";
type ApprovalMode = "auto" | "post" | "pre" | "blocked";
type CostImpact = "low" | "medium" | "high";
type RecoveryDifficulty = "easy" | "moderate" | "hard";

function statePillClass(state: PermissionState | ZoneState | TrendState | ApprovalMode): string {
  if (state === "allowed" || state === "active" || state === "up" || state === "auto")
    return "statusPill statusApproved";
  if (state === "post") return "statusPill statusHeld";
  if (state === "pre") return "statusPill statusHeld";
  if (state === "limited" || state === "flat") return "statusPill statusHeld";
  return "statusPill statusDenied";
}

function parseCostImpact(value: unknown): CostImpact {
  if (value === "medium" || value === "high") return value;
  return "low";
}

function parseRecoveryDifficulty(value: unknown): RecoveryDifficulty {
  if (value === "moderate" || value === "hard") return value;
  return "easy";
}

function readActionMetadata(row: ActionRegistryRow): Record<string, unknown> {
  if (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)) {
    return row.metadata;
  }
  return {};
}

function actionCostImpact(row: ActionRegistryRow): CostImpact {
  const metadata = readActionMetadata(row);
  return parseCostImpact(metadata.cost_impact);
}

function actionRecoveryDifficulty(row: ActionRegistryRow): RecoveryDifficulty {
  const metadata = readActionMetadata(row);
  return parseRecoveryDifficulty(metadata.recovery_difficulty);
}

function isWriteAction(action: string): boolean {
  const v = action.toLowerCase();
  return (
    v.includes("write") ||
    v.includes("create") ||
    v.includes("update") ||
    v.includes("delete") ||
    v.includes("mutating")
  );
}

function isHighStakesAction(action: string): boolean {
  const v = action.toLowerCase();
  return (
    v.includes("high_stakes") ||
    v.includes("payment") ||
    v.includes("wallet") ||
    v.includes("transfer") ||
    v.includes("email.send") ||
    v.includes("delete") ||
    v.includes("mutating")
  );
}

function delegationDepthSummary(tokens: CapabilityTokenRow[]): {
  maxDepth: number;
  rootTokens: number;
  delegatedTokens: number;
} {
  const byId = new Map<string, CapabilityTokenRow>();
  for (const tok of tokens) byId.set(tok.token_id, tok);

  let maxDepth = 0;
  let rootTokens = 0;
  let delegatedTokens = 0;

  for (const tok of tokens) {
    if (!tok.parent_token_id) {
      rootTokens += 1;
      continue;
    }
    delegatedTokens += 1;
    let depth = 0;
    let current: CapabilityTokenRow | undefined = tok;
    const seen = new Set<string>();
    while (current?.parent_token_id) {
      if (seen.has(current.token_id)) break;
      seen.add(current.token_id);
      depth += 1;
      current = byId.get(current.parent_token_id);
      if (!current) break;
    }
    if (depth > maxDepth) maxDepth = depth;
  }

  return { maxDepth, rootTokens, delegatedTokens };
}

function delegationGraphRows(tokens: CapabilityTokenRow[]): Array<{
  token_id: string;
  parent_token_id: string | null;
  depth: number;
  active: boolean;
  created_at: string;
}> {
  const byId = new Map<string, CapabilityTokenRow>();
  for (const tok of tokens) byId.set(tok.token_id, tok);

  function depthOf(tok: CapabilityTokenRow): number {
    let depth = 0;
    let current: CapabilityTokenRow | undefined = tok;
    const seen = new Set<string>();
    while (current?.parent_token_id) {
      if (seen.has(current.token_id)) break;
      seen.add(current.token_id);
      depth += 1;
      current = byId.get(current.parent_token_id);
      if (!current) break;
    }
    return depth;
  }

  return tokens
    .map((tok) => ({
      token_id: tok.token_id,
      parent_token_id: tok.parent_token_id,
      depth: depthOf(tok),
      active: isTokenActive(tok),
      created_at: tok.created_at,
    }))
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.created_at.localeCompare(a.created_at);
    });
}

type ScopeSummary = {
  rooms: string[];
  tools: string[];
  dataRead: string[];
  dataWrite: string[];
  egress: string[];
  actions: string[];
};

function unionScopes(tokens: CapabilityTokenRow[]): ScopeSummary {
  const rooms = new Set<string>();
  const tools = new Set<string>();
  const dataRead = new Set<string>();
  const dataWrite = new Set<string>();
  const egress = new Set<string>();
  const actions = new Set<string>();

  for (const t of tokens) {
    if (!isTokenActive(t)) continue;
    for (const r of t.scopes.rooms ?? []) rooms.add(r);
    for (const r of t.scopes.tools ?? []) tools.add(r);
    for (const r of t.scopes.egress_domains ?? []) egress.add(r);
    for (const r of t.scopes.action_types ?? []) actions.add(r);
    for (const r of t.scopes.data_access?.read ?? []) dataRead.add(r);
    for (const r of t.scopes.data_access?.write ?? []) dataWrite.add(r);
  }

  function sorted(set: Set<string>): string[] {
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  return {
    rooms: sorted(rooms),
    tools: sorted(tools),
    dataRead: sorted(dataRead),
    dataWrite: sorted(dataWrite),
    egress: sorted(egress),
    actions: sorted(actions),
  };
}

const agentStorageKey = "agentapp.agent_id";
const operatorStorageKey = "agentapp.operator_actor_id";
const autoVerifyPendingStorageKey = "agentapp.onboarding.auto_verify_pending";
const autoAssessVerifiedStorageKey = "agentapp.onboarding.auto_assess_verified";

function readStoredBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

const agentChangeEventTypes = [
  "agent.capability.granted",
  "agent.capability.revoked",
  "agent.trust.increased",
  "agent.trust.decreased",
  "autonomy.upgrade.recommended",
  "autonomy.upgrade.approved",
  "agent.quarantined",
  "agent.unquarantined",
  "constraint.learned",
  "mistake.repeated",
  "daily.agent.snapshot",
] as const;

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shortId(value: unknown): string {
  const v = readString(value);
  if (!v) return "-";
  if (v.length <= 18) return v;
  return `${v.slice(0, 8)}…${v.slice(-6)}`;
}

function summarizeAgentChangeEvent(event: EventRow): string {
  const data = asObject(event.data);
  if (event.event_type === "agent.trust.increased" || event.event_type === "agent.trust.decreased") {
    const prev = readNumber(data.previous_score);
    const next = readNumber(data.trust_score);
    if (prev != null && next != null) return `${prev.toFixed(3)} -> ${next.toFixed(3)}`;
  }
  if (event.event_type === "agent.capability.granted") {
    const token = shortId(data.token_id);
    return `#${token}`;
  }
  if (event.event_type === "agent.capability.revoked") {
    const token = shortId(data.token_id);
    const reason = readString(data.reason);
    return reason ? `#${token} (${reason})` : `#${token}`;
  }
  if (event.event_type === "autonomy.upgrade.recommended") {
    return shortId(data.recommendation_id);
  }
  if (event.event_type === "autonomy.upgrade.approved") {
    return `${shortId(data.recommendation_id)} / ${shortId(data.token_id)}`;
  }
  if (event.event_type === "agent.quarantined") {
    const reason = readString(data.quarantine_reason);
    return reason ? reason : "-";
  }
  if (event.event_type === "agent.unquarantined") {
    const reason = readString(data.previous_quarantine_reason);
    return reason ? reason : "-";
  }
  if (event.event_type === "constraint.learned" || event.event_type === "mistake.repeated") {
    const reasonCode = readString(data.reason_code) ?? "-";
    const repeat = readNumber(data.repeat_count);
    return repeat != null ? `${reasonCode} (x${repeat})` : reasonCode;
  }
  if (event.event_type === "daily.agent.snapshot") {
    const date = readString(data.snapshot_date) ?? "-";
    const trust = readNumber(data.trust_score);
    if (trust != null) return `${date} / ${trust.toFixed(3)}`;
    return date;
  }
  return "-";
}

export function AgentProfilePage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function openInspectorByRun(nextRunId: string): void {
    const runId = nextRunId.trim();
    if (!runId) return;
    navigate(`/inspector?run_id=${encodeURIComponent(runId)}`);
  }

  function openInspectorByEvent(nextEventId: string, nextRunId: string | null): void {
    const eventId = nextEventId.trim();
    if (!eventId) return;
    const params = new URLSearchParams();
    params.set("event_id", eventId);
    const runId = nextRunId?.trim() ?? "";
    if (runId) params.set("run_id", runId);
    navigate(`/inspector?${params.toString()}`);
  }

  const tabs: Array<{ key: TabKey; label: string }> = useMemo(
    () => [
      { key: "permissions", label: t("agent_profile.tab.permissions") },
      { key: "growth", label: t("agent_profile.tab.growth") },
    ],
    [t],
  );

  const [activeTab, setActiveTab] = useState<TabKey>("permissions");

  const [agents, setAgents] = useState<RegisteredAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState<boolean>(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentOnboardingWorkById, setAgentOnboardingWorkById] = useState<Record<string, number>>({});
  const [agentOnboardingWorkLoading, setAgentOnboardingWorkLoading] = useState<boolean>(false);
  const [agentOnboardingWorkError, setAgentOnboardingWorkError] = useState<string | null>(null);

  const [agentId, setAgentId] = useState<string>(() => localStorage.getItem(agentStorageKey) ?? "");
  const [manualAgentId, setManualAgentId] = useState<string>("");
  const [operatorActorId, setOperatorActorId] = useState<string>(
    () => localStorage.getItem(operatorStorageKey) ?? "anon",
  );

  const [registerDisplayName, setRegisterDisplayName] = useState<string>("");
  const [registerLoading, setRegisterLoading] = useState<boolean>(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [skillImportJson, setSkillImportJson] = useState<string>("");
  const [skillImportLoading, setSkillImportLoading] = useState<boolean>(false);
  const [skillImportError, setSkillImportError] = useState<string | null>(null);
  const [skillImportResult, setSkillImportResult] = useState<AgentSkillImportResponseV1 | null>(null);
  const [skillImportVerifyLoading, setSkillImportVerifyLoading] = useState<boolean>(false);
  const [skillImportVerifyProgress, setSkillImportVerifyProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [skillImportVerifyErrors, setSkillImportVerifyErrors] = useState<
    Array<{ skill_package_id: string; error_code: string }>
  >([]);
  const [skillImportAssessLoading, setSkillImportAssessLoading] = useState<boolean>(false);
  const [skillImportAssessError, setSkillImportAssessError] = useState<string | null>(null);
  const [skillImportAssessResult, setSkillImportAssessResult] =
    useState<AgentSkillAssessImportedResponseV1 | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<AgentSkillOnboardingStatusResponseV1 | null>(null);
  const [onboardingStatusLoading, setOnboardingStatusLoading] = useState<boolean>(false);
  const [onboardingStatusError, setOnboardingStatusError] = useState<string | null>(null);
  const [onboardingCertifyLoading, setOnboardingCertifyLoading] = useState<boolean>(false);
  const [onboardingCertifyError, setOnboardingCertifyError] = useState<string | null>(null);
  const [onboardingCertifyResult, setOnboardingCertifyResult] = useState<AgentSkillCertifyImportedResponseV1 | null>(
    null,
  );
  const [autoVerifyPendingOnImport, setAutoVerifyPendingOnImport] = useState<boolean>(() =>
    readStoredBool(autoVerifyPendingStorageKey, true),
  );
  const [autoAssessVerifiedOnImport, setAutoAssessVerifiedOnImport] = useState<boolean>(() =>
    readStoredBool(autoAssessVerifiedStorageKey, true),
  );

  const selectedAgent = useMemo(() => agents.find((a) => a.agent_id === agentId) ?? null, [agents, agentId]);

  const [agentMeta, setAgentMeta] = useState<AgentRecordV1 | null>(null);
  const [agentMetaError, setAgentMetaError] = useState<string | null>(null);
  const [agentMetaLoading, setAgentMetaLoading] = useState<boolean>(false);

  const principalId = agentMeta?.principal_id ?? selectedAgent?.principal_id ?? null;
  const isQuarantined = Boolean(agentMeta?.quarantined_at);

  const [quarantineReason, setQuarantineReason] = useState<string>("manual_quarantine");
  const [quarantineActionLoading, setQuarantineActionLoading] = useState<boolean>(false);
  const [quarantineActionError, setQuarantineActionError] = useState<string | null>(null);

  const [trust, setTrust] = useState<AgentTrustRow | null>(null);
  const [trustError, setTrustError] = useState<string | null>(null);
  const [trustLoading, setTrustLoading] = useState<boolean>(false);

  const [tokens, setTokens] = useState<CapabilityTokenRow[]>([]);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [tokensLoading, setTokensLoading] = useState<boolean>(false);

  const [skills, setSkills] = useState<AgentSkillRow[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsLoading, setSkillsLoading] = useState<boolean>(false);

  const [assessments, setAssessments] = useState<AgentSkillAssessmentRow[]>([]);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const [assessmentsLoading, setAssessmentsLoading] = useState<boolean>(false);

  const [snapshots, setSnapshots] = useState<DailyAgentSnapshotRow[]>([]);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState<boolean>(false);

  const [constraints, setConstraints] = useState<ConstraintLearnedRow[]>([]);
  const [constraintsError, setConstraintsError] = useState<string | null>(null);
  const [constraintsLoading, setConstraintsLoading] = useState<boolean>(false);

  const [mistakes, setMistakes] = useState<MistakeRepeatedRow[]>([]);
  const [mistakesError, setMistakesError] = useState<string | null>(null);
  const [mistakesLoading, setMistakesLoading] = useState<boolean>(false);

  const [changeEvents, setChangeEvents] = useState<EventRow[]>([]);
  const [changeEventsError, setChangeEventsError] = useState<string | null>(null);
  const [changeEventsLoading, setChangeEventsLoading] = useState<boolean>(false);

  const [skillPackages, setSkillPackages] = useState<SkillPackageRecordV1[]>([]);
  const [skillPackagesError, setSkillPackagesError] = useState<string | null>(null);
  const [skillPackagesLoading, setSkillPackagesLoading] = useState<boolean>(false);

  const [skillPackagesStatus, setSkillPackagesStatus] = useState<"all" | SkillVerificationStatus>("pending");
  const [skillPackagesSkillId, setSkillPackagesSkillId] = useState<string>("");
  const [skillPackagesLimit, setSkillPackagesLimit] = useState<number>(50);
  const [skillPackagesQuarantineReason, setSkillPackagesQuarantineReason] =
    useState<string>("manual_quarantine");
  const [skillPackagesActionId, setSkillPackagesActionId] = useState<string | null>(null);
  const [skillPackagesActionError, setSkillPackagesActionError] = useState<string | null>(null);
  const [actionRegistryRows, setActionRegistryRows] = useState<ActionRegistryRow[]>([]);
  const [actionRegistryLoading, setActionRegistryLoading] = useState<boolean>(false);
  const [actionRegistryError, setActionRegistryError] = useState<string | null>(null);
  const [approvalRecommendationData, setApprovalRecommendationData] = useState<AgentApprovalRecommendationRow | null>(
    null,
  );
  const [approvalRecommendationLoading, setApprovalRecommendationLoading] = useState<boolean>(false);
  const [approvalRecommendationError, setApprovalRecommendationError] = useState<string | null>(null);

  const [autonomyRecommendationId, setAutonomyRecommendationId] = useState<string>("");
  const [autonomyRecommendation, setAutonomyRecommendation] = useState<AutonomyRecommendationV1 | null>(null);
  const [autonomyRecommendLoading, setAutonomyRecommendLoading] = useState<boolean>(false);
  const [autonomyRecommendError, setAutonomyRecommendError] = useState<string | null>(null);
  const [autonomyApproveLoading, setAutonomyApproveLoading] = useState<boolean>(false);
  const [autonomyApproveError, setAutonomyApproveError] = useState<string | null>(null);
  const [autonomyApproveResult, setAutonomyApproveResult] = useState<AutonomyApproveResponseV1 | null>(null);

  const activeTokens = useMemo(() => tokens.filter((tok) => isTokenActive(tok)), [tokens]);
  const scopeUnion = useMemo(() => unionScopes(tokens), [tokens]);

  const primarySkill = useMemo(() => skills.find((s) => s.is_primary) ?? null, [skills]);
  const topSkills = useMemo(() => skills.slice(0, 6), [skills]);
  const recentAssessments = useMemo(() => assessments.slice(0, 8), [assessments]);
  const assessmentPassedCount = useMemo(
    () => assessments.filter((row) => row.status === "passed").length,
    [assessments],
  );
  const assessmentFailedCount = useMemo(
    () => assessments.filter((row) => row.status === "failed").length,
    [assessments],
  );
  const assessmentRecentRegressions = useMemo(() => {
    const threshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return assessments.filter((row) => {
      if (row.status !== "failed") return false;
      const startedAtMs = new Date(row.started_at).getTime();
      if (!Number.isFinite(startedAtMs)) return false;
      return startedAtMs >= threshold;
    }).length;
  }, [assessments]);
  const localAssessmentSignals = useMemo(() => {
    const now = Date.now();
    const threshold7d = now - 7 * 24 * 60 * 60 * 1000;
    const threshold30d = now - 30 * 24 * 60 * 60 * 1000;

    let failed7d = 0;
    let completed30d = 0;
    let passed30d = 0;

    for (const assessment of assessments) {
      const startedAtMs = new Date(assessment.started_at).getTime();
      if (!Number.isFinite(startedAtMs)) continue;

      if (startedAtMs >= threshold7d && assessment.status === "failed") {
        failed7d += 1;
      }

      if (startedAtMs >= threshold30d && (assessment.status === "passed" || assessment.status === "failed")) {
        completed30d += 1;
        if (assessment.status === "passed") passed30d += 1;
      }
    }

    return {
      failed7d,
      completed30d,
      passed30d,
      passRate30d: completed30d > 0 ? passed30d / completed30d : null,
    };
  }, [assessments]);
  const latestSnapshot = useMemo(() => (snapshots.length ? snapshots[0] : null), [snapshots]);
  const baselineSnapshot = useMemo(() => {
    if (!snapshots.length) return null;
    const idx = Math.min(6, snapshots.length - 1);
    return snapshots[idx] ?? null;
  }, [snapshots]);
  const snapshotRowsForTable = useMemo(() => snapshots.slice(0, 14), [snapshots]);
  const pendingImportPackageIds = useMemo(() => {
    if (!skillImportResult) return [];
    return skillImportResult.items
      .filter((it) => it.status === "pending")
      .map((it) => it.skill_package_id);
  }, [skillImportResult]);
  const onboardingNeedsCertify = useMemo(() => {
    const summary = onboardingStatus?.summary;
    if (!summary) return false;
    return summary.pending > 0 || summary.verified_unassessed > 0;
  }, [onboardingStatus]);
  const agentsWithOnboardingWork = useMemo(
    () => agents.filter((agent) => (agentOnboardingWorkById[agent.agent_id] ?? 0) > 0).length,
    [agents, agentOnboardingWorkById],
  );
  const delegationSummary = useMemo(() => delegationDepthSummary(tokens), [tokens]);
  const delegationRows = useMemo(() => delegationGraphRows(tokens).slice(0, 40), [tokens]);
  const agentTokenIds = useMemo(() => new Set(tokens.map((tok) => tok.token_id)), [tokens]);
  const relevantChangeEvents = useMemo(() => {
    const nextAgentId = agentId.trim();
    if (!nextAgentId) return [];

    const nextPrincipalId = principalId?.trim() ?? null;
    return changeEvents
      .filter((event) => {
        const data = asObject(event.data);
        const eventAgentId = readString(data.agent_id);
        if (eventAgentId && eventAgentId === nextAgentId) return true;

        if (nextPrincipalId) {
          if (readString(data.principal_id) === nextPrincipalId) return true;
          if (readString(data.issued_to_principal_id) === nextPrincipalId) return true;
        }

        const tokenId = readString(data.token_id);
        if (tokenId && agentTokenIds.has(tokenId)) return true;
        return false;
      })
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [changeEvents, agentId, principalId, agentTokenIds]);
  const changeTimelineRows = useMemo(
    () =>
      relevantChangeEvents.slice(0, 20).map((event) => ({
        ...event,
        summary: summarizeAgentChangeEvent(event),
      })),
    [relevantChangeEvents],
  );
  const scopedActionRegistryRows = useMemo(() => {
    if (!scopeUnion.actions.length || !actionRegistryRows.length) return [];
    const registryByType = new Map<string, ActionRegistryRow>();
    for (const row of actionRegistryRows) {
      registryByType.set(row.action_type, row);
    }
    return scopeUnion.actions
      .map((actionType) => registryByType.get(actionType) ?? null)
      .filter((row): row is ActionRegistryRow => row != null);
  }, [scopeUnion.actions, actionRegistryRows]);

  const actionPolicyFlags = useMemo(() => {
    const rows = scopedActionRegistryRows;
    const highStakes = rows.filter((r) => r.zone_required === "high_stakes").length;
    const supervised = rows.filter((r) => r.zone_required === "supervised").length;
    const sandbox = rows.filter((r) => r.zone_required === "sandbox").length;
    const preRequired = rows.some((r) => r.requires_pre_approval);
    const postRequired = rows.some((r) => r.post_review_required);
    const irreversible = rows.some((r) => !r.reversible);
    const reversible = rows.filter((r) => r.reversible).length;
    const highCost = rows.filter((r) => actionCostImpact(r) === "high").length;
    const mediumCost = rows.filter((r) => actionCostImpact(r) === "medium").length;
    const hardRecovery = rows.filter((r) => actionRecoveryDifficulty(r) === "hard").length;
    const moderateRecovery = rows.filter((r) => actionRecoveryDifficulty(r) === "moderate").length;

    return {
      highStakes,
      supervised,
      sandbox,
      preRequired,
      postRequired,
      irreversible,
      reversible,
      highCost,
      mediumCost,
      hardRecovery,
      moderateRecovery,
    };
  }, [scopedActionRegistryRows]);

  const permissionMatrix = useMemo(() => {
    const readScopeCount = scopeUnion.rooms.length + scopeUnion.dataRead.length;
    const writeActionCount = scopeUnion.actions.filter((a) => isWriteAction(a)).length;
    const highStakesCount = Math.max(
      actionPolicyFlags.highStakes,
      scopeUnion.actions.filter((a) => isHighStakesAction(a)).length,
    );
    const writeScopeCount = scopeUnion.dataWrite.length + writeActionCount;
    const externalScopeCount = scopeUnion.egress.length;

    const readState: PermissionState = readScopeCount > 0 ? "allowed" : "blocked";
    const writeState: PermissionState =
      writeScopeCount > 0 ? (isQuarantined ? "limited" : "allowed") : "blocked";
    const externalState: PermissionState =
      externalScopeCount > 0 ? (isQuarantined ? "blocked" : "allowed") : "blocked";
    const highStakesState: PermissionState =
      highStakesCount > 0 ? (isQuarantined ? "blocked" : "allowed") : "blocked";

    return [
      { key: "read", label: t("agent_profile.permission.read"), scopeCount: readScopeCount, state: readState },
      { key: "write", label: t("agent_profile.permission.write"), scopeCount: writeScopeCount, state: writeState },
      {
        key: "external",
        label: t("agent_profile.permission.external"),
        scopeCount: externalScopeCount,
        state: externalState,
      },
      {
        key: "high_stakes",
        label: t("agent_profile.permission.high_stakes"),
        scopeCount: highStakesCount,
        state: highStakesState,
      },
    ] as Array<{ key: string; label: string; scopeCount: number; state: PermissionState }>;
  }, [scopeUnion, actionPolicyFlags.highStakes, isQuarantined, t]);

  const zoneRing = useMemo(() => {
    const writeActionCount = scopeUnion.actions.filter((a) => isWriteAction(a)).length;
    const highStakesCount = Math.max(
      actionPolicyFlags.highStakes,
      scopeUnion.actions.filter((a) => isHighStakesAction(a)).length,
    );
    const hasSupervisedScope =
      scopeUnion.dataWrite.length + writeActionCount + scopeUnion.egress.length + actionPolicyFlags.supervised > 0;
    const hasHighStakesScope = highStakesCount > 0;

    const sandboxState: ZoneState = "active";
    const supervisedState: ZoneState = hasSupervisedScope
      ? isQuarantined
        ? "limited"
        : "active"
      : "blocked";
    const highStakesState: ZoneState = hasHighStakesScope
      ? isQuarantined
        ? "blocked"
        : "active"
      : "blocked";

    return [
      { key: "sandbox", label: t("agent_profile.zone.sandbox"), state: sandboxState },
      { key: "supervised", label: t("agent_profile.zone.supervised"), state: supervisedState },
      { key: "high_stakes", label: t("agent_profile.zone.high_stakes"), state: highStakesState },
    ] as Array<{ key: string; label: string; state: ZoneState }>;
  }, [scopeUnion, actionPolicyFlags.highStakes, actionPolicyFlags.supervised, isQuarantined, t]);

  const localApprovalRecommendations = useMemo(() => {
    const trustScore = trust?.trust_score ?? 0;
    const hasWriteScope = scopeUnion.dataWrite.length > 0 || scopeUnion.actions.some((a) => isWriteAction(a));
    const hasExternalScope = scopeUnion.egress.length > 0;
    const hasHighStakesScope =
      actionPolicyFlags.highStakes > 0 || scopeUnion.actions.some((a) => isHighStakesAction(a));
    const repeatedMistakes7d = latestSnapshot?.repeated_mistakes_7d ?? 0;
    const autonomyRate7d = latestSnapshot?.autonomy_rate_7d ?? null;
    const hasRepeatedMistakeRisk = repeatedMistakes7d >= 2;
    const hasLowAutonomyRisk = autonomyRate7d != null && autonomyRate7d < 0.5;
    const hasAssessmentRegressionRisk =
      localAssessmentSignals.failed7d >= 2 ||
      (localAssessmentSignals.completed30d >= 3 &&
        localAssessmentSignals.passRate30d != null &&
        localAssessmentSignals.passRate30d < 0.6);
    const hasHighCostRisk = actionPolicyFlags.highCost > 0;
    const hasMediumCostRisk = actionPolicyFlags.mediumCost > 0;
    const hasHardRecoveryRisk = actionPolicyFlags.hardRecovery > 0;

    const dedupe = (items: string[]): string[] => [...new Set(items)];

    let internalWriteMode: ApprovalMode = "blocked";
    let internalBasis: string[] = [];
    if (hasWriteScope) {
      if (isQuarantined) {
        internalWriteMode = "pre";
        internalBasis = [t("agent_profile.approval.basis.quarantine")];
      } else if (actionPolicyFlags.preRequired || actionPolicyFlags.highStakes > 0 || actionPolicyFlags.irreversible) {
        internalWriteMode = "pre";
        internalBasis = [t("agent_profile.approval.basis.pre_required")];
        if (actionPolicyFlags.irreversible) internalBasis.push(t("agent_profile.approval.basis.irreversible"));
        if (actionPolicyFlags.highStakes > 0) internalBasis.push(t("agent_profile.approval.basis.high_stakes"));
      } else if (actionPolicyFlags.postRequired) {
        internalWriteMode = "post";
        internalBasis = [t("agent_profile.approval.basis.post_required")];
      } else if (trustScore >= 0.75) {
        internalWriteMode = "auto";
        internalBasis = [t("agent_profile.approval.basis.high_trust")];
      } else if (trustScore >= 0.45) {
        internalWriteMode = "post";
        internalBasis = [t("agent_profile.approval.basis.default")];
      } else {
        internalWriteMode = "pre";
        internalBasis = [t("agent_profile.approval.basis.default")];
      }
      if (hasHighCostRisk) {
        if (internalWriteMode === "auto") internalWriteMode = "post";
        if (internalWriteMode === "post") internalWriteMode = "pre";
        internalBasis.push(t("agent_profile.approval.basis.high_cost"));
      }
      if (hasHardRecoveryRisk) {
        if (internalWriteMode === "auto") internalWriteMode = "post";
        if (internalWriteMode === "post") internalWriteMode = "pre";
        internalBasis.push(t("agent_profile.approval.basis.hard_recovery"));
      }
      if (hasMediumCostRisk) {
        if (internalWriteMode === "auto") internalWriteMode = "post";
        internalBasis.push(t("agent_profile.approval.basis.medium_cost"));
      }
      if (hasRepeatedMistakeRisk) {
        if (internalWriteMode === "auto") internalWriteMode = "post";
        internalBasis.push(t("agent_profile.approval.basis.repeated_mistakes"));
      }
      if (hasLowAutonomyRisk) {
        if (internalWriteMode === "auto") internalWriteMode = "post";
        if (internalWriteMode === "post") internalWriteMode = "pre";
        internalBasis.push(t("agent_profile.approval.basis.low_autonomy"));
      }
      if (hasAssessmentRegressionRisk) {
        if (internalWriteMode === "auto") internalWriteMode = "post";
        if (internalWriteMode === "post") internalWriteMode = "pre";
        internalBasis.push(t("agent_profile.approval.basis.assessment_regression"));
      }
      internalBasis = dedupe(internalBasis);
    } else {
      internalBasis = [t("agent_profile.approval.basis.no_scope")];
    }

    let externalWriteMode: ApprovalMode = "blocked";
    let externalBasis: string[] = [];
    if (hasExternalScope) {
      if (isQuarantined) {
        externalWriteMode = "blocked";
        externalBasis = [t("agent_profile.approval.basis.quarantine")];
      } else if (actionPolicyFlags.preRequired || actionPolicyFlags.highStakes > 0) {
        externalWriteMode = "pre";
        externalBasis = [t("agent_profile.approval.basis.pre_required")];
        if (actionPolicyFlags.highStakes > 0) externalBasis.push(t("agent_profile.approval.basis.high_stakes"));
      } else if (actionPolicyFlags.postRequired) {
        externalWriteMode = "post";
        externalBasis = [t("agent_profile.approval.basis.post_required")];
      } else if (trustScore >= 0.85 && !actionPolicyFlags.irreversible) {
        externalWriteMode = "auto";
        externalBasis = [t("agent_profile.approval.basis.high_trust")];
      } else {
        externalWriteMode = "post";
        externalBasis = [t("agent_profile.approval.basis.default")];
      }
      if (hasHighCostRisk) {
        if (externalWriteMode === "auto") externalWriteMode = "post";
        if (externalWriteMode === "post") externalWriteMode = "pre";
        externalBasis.push(t("agent_profile.approval.basis.high_cost"));
      }
      if (hasHardRecoveryRisk) {
        if (externalWriteMode === "auto") externalWriteMode = "post";
        if (externalWriteMode === "post") externalWriteMode = "pre";
        externalBasis.push(t("agent_profile.approval.basis.hard_recovery"));
      }
      if (hasMediumCostRisk) {
        if (externalWriteMode === "auto") externalWriteMode = "post";
        externalBasis.push(t("agent_profile.approval.basis.medium_cost"));
      }
      if (hasRepeatedMistakeRisk) {
        if (externalWriteMode === "auto") externalWriteMode = "post";
        if (externalWriteMode === "post") externalWriteMode = "pre";
        externalBasis.push(t("agent_profile.approval.basis.repeated_mistakes"));
      }
      if (hasLowAutonomyRisk) {
        if (externalWriteMode === "auto") externalWriteMode = "post";
        if (externalWriteMode === "post") externalWriteMode = "pre";
        externalBasis.push(t("agent_profile.approval.basis.low_autonomy"));
      }
      if (hasAssessmentRegressionRisk) {
        if (externalWriteMode === "auto") externalWriteMode = "post";
        if (externalWriteMode === "post") externalWriteMode = "pre";
        externalBasis.push(t("agent_profile.approval.basis.assessment_regression"));
      }
      externalBasis = dedupe(externalBasis);
    } else {
      externalBasis = [t("agent_profile.approval.basis.no_scope")];
    }

    let highStakesMode: ApprovalMode = "blocked";
    let highStakesBasis: string[] = [t("agent_profile.approval.basis.high_stakes")];
    if (hasHighStakesScope) {
      highStakesMode = isQuarantined ? "blocked" : "pre";
      if (isQuarantined) highStakesBasis.push(t("agent_profile.approval.basis.quarantine"));
      if (hasHighCostRisk) highStakesBasis.push(t("agent_profile.approval.basis.high_cost"));
      if (hasHardRecoveryRisk) highStakesBasis.push(t("agent_profile.approval.basis.hard_recovery"));
      if (hasMediumCostRisk) highStakesBasis.push(t("agent_profile.approval.basis.medium_cost"));
    } else {
      highStakesBasis = [t("agent_profile.approval.basis.no_scope")];
    }

    return [
      {
        key: "internal_write",
        label: t("agent_profile.approval.target.internal_write"),
        mode: internalWriteMode,
        basis: dedupe(internalBasis).join(" · "),
      },
      {
        key: "external_write",
        label: t("agent_profile.approval.target.external_write"),
        mode: externalWriteMode,
        basis: dedupe(externalBasis).join(" · "),
      },
      {
        key: "high_stakes",
        label: t("agent_profile.approval.target.high_stakes"),
        mode: highStakesMode,
        basis: dedupe(highStakesBasis).join(" · "),
      },
    ] as Array<{ key: string; label: string; mode: ApprovalMode; basis: string }>;
  }, [scopeUnion, actionPolicyFlags, trust, isQuarantined, latestSnapshot, localAssessmentSignals, t]);

  const apiApprovalRecommendations = useMemo(() => {
    if (!approvalRecommendationData) return null;

    const toLabel = (target: ApprovalRecommendationTarget): string => {
      if (target === "internal_write") return t("agent_profile.approval.target.internal_write");
      if (target === "external_write") return t("agent_profile.approval.target.external_write");
      return t("agent_profile.approval.target.high_stakes");
    };

    const toBasisText = (basisCodes: ApprovalRecommendationBasisCode[]): string => {
      if (!basisCodes.length) return t("agent_profile.approval.basis.default");
      const unique = [...new Set(basisCodes)];
      return unique
        .map((code) => t(`agent_profile.approval.basis.${code}`))
        .join(" · ");
    };

    const byTarget = new Map<ApprovalRecommendationTarget, AgentApprovalRecommendationTargetRow>();
    for (const target of approvalRecommendationData.targets ?? []) {
      byTarget.set(target.target, target);
    }

    const orderedTargets: ApprovalRecommendationTarget[] = [
      "internal_write",
      "external_write",
      "high_stakes",
    ];

    return orderedTargets.map((target) => {
      const row = byTarget.get(target);
      if (!row) {
        return {
          key: target,
          label: toLabel(target),
          mode: "blocked" as ApprovalMode,
          basis: t("agent_profile.approval.basis.no_scope"),
        };
      }
      return {
        key: target,
        label: toLabel(target),
        mode: row.mode as ApprovalMode,
        basis: toBasisText(row.basis_codes ?? []),
      };
    });
  }, [approvalRecommendationData, t]);

  const approvalRecommendations = apiApprovalRecommendations ?? localApprovalRecommendations;
  const approvalAssessmentSignals = useMemo(() => {
    const context = approvalRecommendationData?.context;
    if (context) {
      const failed7d = Number(context.assessment_failed_7d ?? 0);
      const completed30d = Number(context.assessment_completed_30d ?? 0);
      const passed30d = Number(context.assessment_passed_30d ?? 0);
      const passRate30d =
        typeof context.assessment_pass_rate_30d === "number" &&
        Number.isFinite(context.assessment_pass_rate_30d)
          ? context.assessment_pass_rate_30d
          : null;

      return {
        failed7d: Number.isFinite(failed7d) ? Math.max(0, Math.floor(failed7d)) : 0,
        completed30d: Number.isFinite(completed30d) ? Math.max(0, Math.floor(completed30d)) : 0,
        passed30d: Number.isFinite(passed30d) ? Math.max(0, Math.floor(passed30d)) : 0,
        passRate30d,
      };
    }
    return localAssessmentSignals;
  }, [approvalRecommendationData, localAssessmentSignals]);
  const approvalAssessmentRiskElevated = useMemo(() => {
    return (
      approvalAssessmentSignals.failed7d >= 2 ||
      (approvalAssessmentSignals.completed30d >= 3 &&
        approvalAssessmentSignals.passRate30d != null &&
        approvalAssessmentSignals.passRate30d < 0.6)
    );
  }, [approvalAssessmentSignals]);
  const approvalAssessmentRiskTrend: TrendState = useMemo(() => {
    if (approvalAssessmentRiskElevated) return "down";
    if (approvalAssessmentSignals.completed30d >= 3) return "up";
    return "flat";
  }, [approvalAssessmentRiskElevated, approvalAssessmentSignals.completed30d]);

  const trustDelta7d = useMemo(() => {
    if (!latestSnapshot || !baselineSnapshot) return null;
    return latestSnapshot.trust_score - baselineSnapshot.trust_score;
  }, [latestSnapshot, baselineSnapshot]);
  const autonomyDelta7d = useMemo(() => {
    if (!latestSnapshot || !baselineSnapshot) return null;
    return latestSnapshot.autonomy_rate_7d - baselineSnapshot.autonomy_rate_7d;
  }, [latestSnapshot, baselineSnapshot]);
  const trustTrend: TrendState = useMemo(() => {
    if (trustDelta7d == null || Math.abs(trustDelta7d) < 0.0001) return "flat";
    return trustDelta7d > 0 ? "up" : "down";
  }, [trustDelta7d]);
  const autonomyTrend: TrendState = useMemo(() => {
    if (autonomyDelta7d == null || Math.abs(autonomyDelta7d) < 0.0001) return "flat";
    return autonomyDelta7d > 0 ? "up" : "down";
  }, [autonomyDelta7d]);
  const trustGrowthPct = useMemo(() => {
    if (snapshots.length < 14) return null;
    const currentAvg = average(snapshots.slice(0, 7).map((s) => s.trust_score));
    const previousAvg = average(snapshots.slice(7, 14).map((s) => s.trust_score));
    return growthRate(currentAvg, previousAvg);
  }, [snapshots]);
  const autonomyGrowthPct = useMemo(() => {
    if (snapshots.length < 14) return null;
    const currentAvg = average(snapshots.slice(0, 7).map((s) => s.autonomy_rate_7d));
    const previousAvg = average(snapshots.slice(7, 14).map((s) => s.autonomy_rate_7d));
    return growthRate(currentAvg, previousAvg);
  }, [snapshots]);
  const trustGrowthTrend: TrendState = useMemo(() => {
    if (trustGrowthPct == null || Math.abs(trustGrowthPct) < 0.0001) return "flat";
    return trustGrowthPct > 0 ? "up" : "down";
  }, [trustGrowthPct]);
  const autonomyGrowthTrend: TrendState = useMemo(() => {
    if (autonomyGrowthPct == null || Math.abs(autonomyGrowthPct) < 0.0001) return "flat";
    return autonomyGrowthPct > 0 ? "up" : "down";
  }, [autonomyGrowthPct]);
  const latestNewSkills7d = latestSnapshot?.new_skills_learned_7d ?? 0;
  const latestRepeatedMistakes7d = latestSnapshot?.repeated_mistakes_7d ?? 0;

  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(null);

    void (async () => {
      try {
        const res = await listRegisteredAgents({ limit: 200 });
        if (cancelled) return;
        setAgents(res);

        // If no agent selected yet, pick the most recent one (if any).
        const stored = localStorage.getItem(agentStorageKey) ?? "";
        if (!stored && res.length) {
          setAgentId(res[0].agent_id);
        }
      } catch (e) {
        if (cancelled) return;
        setAgentsError(toErrorCode(e));
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(agentStorageKey, agentId);

    setAgentMeta(null);
    setAgentMetaError(null);
    setQuarantineActionError(null);
    setQuarantineActionLoading(false);
    setQuarantineReason("manual_quarantine");
    setSkillImportError(null);
    setSkillImportResult(null);
    setSkillImportVerifyErrors([]);
    setSkillImportVerifyProgress(null);
    setSkillImportVerifyLoading(false);
    setSkillImportAssessLoading(false);
    setSkillImportAssessError(null);
    setSkillImportAssessResult(null);
    setOnboardingStatus(null);
    setOnboardingStatusError(null);
    setOnboardingStatusLoading(false);
    setOnboardingCertifyLoading(false);
    setOnboardingCertifyError(null);
    setOnboardingCertifyResult(null);

    setTrust(null);
    setTokens([]);
    setSkills([]);
    setAssessments([]);
    setSnapshots([]);
    setConstraints([]);
    setMistakes([]);

    setTrustError(null);
    setTokensError(null);
    setSkillsError(null);
    setAssessmentsError(null);
    setSnapshotsError(null);
    setConstraintsError(null);
    setMistakesError(null);
    setChangeEvents([]);
    setChangeEventsError(null);
    setChangeEventsLoading(false);
    setApprovalRecommendationData(null);
    setApprovalRecommendationError(null);
    setApprovalRecommendationLoading(false);

    setAutonomyRecommendation(null);
    setAutonomyRecommendationId("");
    setAutonomyRecommendError(null);
    setAutonomyRecommendLoading(false);
    setAutonomyApproveError(null);
    setAutonomyApproveLoading(false);
    setAutonomyApproveResult(null);

    if (!agentId.trim()) {
      setAgentMetaLoading(false);
      setTrustLoading(false);
      setSkillsLoading(false);
      setAssessmentsLoading(false);
      setSnapshotsLoading(false);
      setConstraintsLoading(false);
      setMistakesLoading(false);
      setChangeEventsLoading(false);
      setTokensLoading(false);
      setApprovalRecommendationLoading(false);
      setOnboardingStatusLoading(false);
      return;
    }
    let cancelled = false;

    setAgentMetaLoading(true);
    void (async () => {
      try {
        const meta = await getAgent(agentId);
        if (cancelled) return;
        setAgentMeta(meta);
        if (meta.quarantine_reason) setQuarantineReason(meta.quarantine_reason);
      } catch (e) {
        if (cancelled) return;
        setAgentMetaError(toErrorCode(e));
      } finally {
        if (!cancelled) setAgentMetaLoading(false);
      }
    })();

    setTrustLoading(true);
    setSkillsLoading(true);
    setAssessmentsLoading(true);
    setSnapshotsLoading(true);
    setConstraintsLoading(true);
    setMistakesLoading(true);
    setApprovalRecommendationLoading(true);
    setOnboardingStatusLoading(true);
    setOnboardingStatusError(null);

    void (async () => {
      try {
        const [coreResult, recommendationResult, onboardingResult] = await Promise.allSettled([
          Promise.all([
            getAgentTrust(agentId),
            listAgentSkills({ agent_id: agentId, limit: 50 }),
            listAgentSkillAssessments({ agent_id: agentId, limit: 100 }),
            listAgentSnapshots({ agent_id: agentId, days: 30 }),
            listConstraintLearnedEvents({ agent_id: agentId, limit: 200 }),
            listMistakeRepeatedEvents({ agent_id: agentId, limit: 200 }),
          ]),
          getAgentApprovalRecommendation(agentId),
          getAgentSkillOnboardingStatus(agentId),
        ]);

        if (cancelled) return;

        if (coreResult.status === "fulfilled") {
          const [trustRes, skillsRes, assessmentsRes, snapshotsRes, constraintsRes, mistakesRes] =
            coreResult.value;
          setTrust(trustRes);
          setSkills(skillsRes);
          setAssessments(assessmentsRes);
          setSnapshots(snapshotsRes);
          setConstraints(constraintsRes);
          setMistakes(mistakesRes);
        } else {
          const code = toErrorCode(coreResult.reason);
          setTrustError(code);
          setSkillsError(code);
          setAssessmentsError(code);
          setSnapshotsError(code);
          setConstraintsError(code);
          setMistakesError(code);
        }

        if (recommendationResult.status === "fulfilled") {
          setApprovalRecommendationData(recommendationResult.value);
          setApprovalRecommendationError(null);
        } else {
          setApprovalRecommendationError(toErrorCode(recommendationResult.reason));
        }

        if (onboardingResult.status === "fulfilled") {
          setOnboardingStatus(onboardingResult.value);
          setOnboardingStatusError(null);
          setAgentOnboardingWorkById((prev) => ({
            ...prev,
            [agentId]: onboardingWorkCount(onboardingResult.value),
          }));
        } else {
          setOnboardingStatusError(toErrorCode(onboardingResult.reason));
        }
      } finally {
        if (cancelled) return;
        setTrustLoading(false);
        setSkillsLoading(false);
        setAssessmentsLoading(false);
        setSnapshotsLoading(false);
        setConstraintsLoading(false);
        setMistakesLoading(false);
        setApprovalRecommendationLoading(false);
        setOnboardingStatusLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    if (!agents.length) {
      setAgentOnboardingWorkById({});
      setAgentOnboardingWorkLoading(false);
      setAgentOnboardingWorkError(null);
      return;
    }

    setAgentOnboardingWorkLoading(true);
    setAgentOnboardingWorkError(null);

    void (async () => {
      try {
        const next: Record<string, number> = {};
        const chunkSize = 8;

        for (let idx = 0; idx < agents.length; idx += chunkSize) {
          const chunk = agents.slice(idx, idx + chunkSize);
          const settled = await Promise.allSettled(
            chunk.map(async (agent) => {
              const status = await getAgentSkillOnboardingStatus(agent.agent_id);
              return {
                agent_id: agent.agent_id,
                work_count: onboardingWorkCount(status),
              };
            }),
          );
          if (cancelled) return;
          for (const item of settled) {
            if (item.status !== "fulfilled") continue;
            next[item.value.agent_id] = item.value.work_count;
          }
        }

        if (cancelled) return;
        setAgentOnboardingWorkById(next);
      } catch (e) {
        if (cancelled) return;
        setAgentOnboardingWorkError(toErrorCode(e));
      } finally {
        if (!cancelled) setAgentOnboardingWorkLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agents]);

  useEffect(() => {
    localStorage.setItem(operatorStorageKey, operatorActorId);
  }, [operatorActorId]);

  useEffect(() => {
    localStorage.setItem(autoVerifyPendingStorageKey, autoVerifyPendingOnImport ? "1" : "0");
  }, [autoVerifyPendingOnImport]);

  useEffect(() => {
    localStorage.setItem(autoAssessVerifiedStorageKey, autoAssessVerifiedOnImport ? "1" : "0");
  }, [autoAssessVerifiedOnImport]);

  useEffect(() => {
    setTokens([]);
    setTokensError(null);

    if (!principalId?.trim()) {
      setTokensLoading(false);
      return;
    }

    let cancelled = false;
    setTokensLoading(true);

    void (async () => {
      try {
        const tok = await listCapabilityTokens(principalId);
        if (cancelled) return;
        setTokens(tok);
      } catch (e) {
        if (cancelled) return;
        setTokensError(toErrorCode(e));
      } finally {
        if (!cancelled) setTokensLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [principalId]);

  async function reloadTokens(): Promise<void> {
    const nextPrincipalId = principalId?.trim();
    if (!nextPrincipalId) {
      setTokens([]);
      setTokensError(null);
      setTokensLoading(false);
      return;
    }

    setTokensLoading(true);
    setTokensError(null);
    try {
      const tok = await listCapabilityTokens(nextPrincipalId);
      setTokens(tok);
    } catch (e) {
      setTokensError(toErrorCode(e));
    } finally {
      setTokensLoading(false);
    }
  }

  async function reloadApprovalRecommendation(nextAgentId?: string): Promise<void> {
    const agent_id = (nextAgentId ?? agentId).trim();
    if (!agent_id) {
      setApprovalRecommendationData(null);
      setApprovalRecommendationError(null);
      setApprovalRecommendationLoading(false);
      return;
    }

    setApprovalRecommendationLoading(true);
    setApprovalRecommendationError(null);
    try {
      const res = await getAgentApprovalRecommendation(agent_id);
      setApprovalRecommendationData(res);
    } catch (e) {
      setApprovalRecommendationError(toErrorCode(e));
    } finally {
      setApprovalRecommendationLoading(false);
    }
  }

  async function reloadChangeEvents(nextAgentId?: string): Promise<void> {
    const agent_id = (nextAgentId ?? agentId).trim();
    const subject_principal_id = principalId?.trim() || undefined;
    if (!agent_id) {
      setChangeEvents([]);
      setChangeEventsError(null);
      setChangeEventsLoading(false);
      return;
    }

    setChangeEventsLoading(true);
    setChangeEventsError(null);
    try {
      const rows = await listEvents({
        event_types: [...agentChangeEventTypes],
        subject_agent_id: agent_id,
        subject_principal_id,
        limit: 300,
      });
      setChangeEvents(rows);
    } catch (e) {
      setChangeEventsError(toErrorCode(e));
    } finally {
      setChangeEventsLoading(false);
    }
  }

  async function ensureOperatorPrincipalId(): Promise<string> {
    const actor_id = operatorActorId.trim() || "anon";
    const principal = await ensureLegacyPrincipal({ actor_type: "user", actor_id });
    return principal.principal_id;
  }

  async function reloadSkillPackages(): Promise<void> {
    const limitNum = Number(skillPackagesLimit);
    const limit = Number.isFinite(limitNum) ? Math.max(1, Math.min(200, Math.floor(limitNum))) : 50;
    const skill_id = skillPackagesSkillId.trim() || undefined;
    const status = skillPackagesStatus === "all" ? undefined : skillPackagesStatus;

    setSkillPackagesLoading(true);
    setSkillPackagesError(null);
    setSkillPackagesActionError(null);
    try {
      const rows = await listSkillPackages({ status, skill_id, limit });
      setSkillPackages(rows);
    } catch (e) {
      setSkillPackagesError(toErrorCode(e));
    } finally {
      setSkillPackagesLoading(false);
    }
  }

  async function reloadOnboardingStatus(agentOverride?: string): Promise<void> {
    const nextAgentId = (agentOverride ?? agentId).trim();
    if (!nextAgentId) {
      setOnboardingStatus(null);
      setOnboardingStatusError(null);
      setOnboardingStatusLoading(false);
      return;
    }

    setOnboardingStatusLoading(true);
    setOnboardingStatusError(null);
    try {
      const status = await getAgentSkillOnboardingStatus(nextAgentId);
      setOnboardingStatus(status);
      setAgentOnboardingWorkById((prev) => ({
        ...prev,
        [nextAgentId]: onboardingWorkCount(status),
      }));
    } catch (e) {
      setOnboardingStatusError(toErrorCode(e));
    } finally {
      setOnboardingStatusLoading(false);
    }
  }

  async function certifyImportedSkillsFromStatus(): Promise<void> {
    const nextAgentId = agentId.trim();
    if (!nextAgentId) return;

    setOnboardingCertifyLoading(true);
    setOnboardingCertifyError(null);
    setOnboardingCertifyResult(null);
    try {
      const actor_id = operatorActorId.trim() || "anon";
      const principal_id = await ensureOperatorPrincipalId();
      const certified = await certifyImportedAgentSkills(nextAgentId, {
        actor_type: "user",
        actor_id,
        principal_id,
        actor_principal_id: principal_id,
        only_unassessed: true,
        limit: 200,
      });
      setOnboardingCertifyResult(certified);
      await reloadSkillPackages();
      await refreshAgentGrowthViews(nextAgentId);
      await reloadOnboardingStatus(nextAgentId);
    } catch (e) {
      setOnboardingCertifyError(toErrorCode(e));
    } finally {
      setOnboardingCertifyLoading(false);
    }
  }

  async function verifyPendingSkillPackageIds(
    pendingIds: string[],
    baseResult?: AgentSkillImportResponseV1,
  ): Promise<void> {
    const agent_id = agentId.trim();
    if (!agent_id) return;
    if (!pendingIds.length) return;

    setSkillImportVerifyLoading(true);
    setSkillImportVerifyErrors([]);
    setSkillImportVerifyProgress({ done: 0, total: pendingIds.length });

    try {
      // Prefer server-side bulk review (TASK-197 API). Fall back to per-package verify for compatibility.
      try {
        const principal = await ensureOperatorPrincipalId();
        const actor_id = operatorActorId.trim() || "anon";
        const reviewed = await reviewPendingAgentSkills(agent_id, {
          actor_type: "user",
          actor_id,
          principal_id: principal,
        });
        const statusById = new Map(reviewed.items.map((it) => [it.skill_package_id, it.status] as const));

        setSkillImportResult((prev) => {
          const current = prev ?? baseResult ?? null;
          if (!current) return prev;
          const items = current.items.map((it) => {
            const nextStatus = statusById.get(it.skill_package_id);
            return nextStatus ? { ...it, status: nextStatus } : it;
          });
          const summary = {
            total: items.length,
            verified: items.filter((it) => it.status === "verified").length,
            pending: items.filter((it) => it.status === "pending").length,
            quarantined: items.filter((it) => it.status === "quarantined").length,
          };
          return { summary, items };
        });
        setSkillImportVerifyProgress({ done: pendingIds.length, total: pendingIds.length });
      } catch {
        const verified = new Set<string>();
        const errors: Array<{ skill_package_id: string; error_code: string }> = [];

        for (let idx = 0; idx < pendingIds.length; idx += 1) {
          const skill_package_id = pendingIds[idx];
          try {
            await verifySkillPackage(skill_package_id);
            verified.add(skill_package_id);
          } catch (e) {
            errors.push({ skill_package_id, error_code: toErrorCode(e) });
          } finally {
            setSkillImportVerifyProgress({ done: idx + 1, total: pendingIds.length });
          }
        }

        setSkillImportVerifyErrors(errors);
        setSkillImportResult((prev) => {
          const current = prev ?? baseResult ?? null;
          if (!current) return prev;
          const items = current.items.map((it) =>
            verified.has(it.skill_package_id) ? { ...it, status: "verified" as const } : it,
          );
          const summary = {
            total: items.length,
            verified: items.filter((it) => it.status === "verified").length,
            pending: items.filter((it) => it.status === "pending").length,
            quarantined: items.filter((it) => it.status === "quarantined").length,
          };
          return { summary, items };
        });
      }

      await reloadSkillPackages();
      if (autoAssessVerifiedOnImport) {
        await assessImportedSkillsFromImport(baseResult, { clearPrevious: true });
      }
      await reloadOnboardingStatus(agent_id);
    } finally {
      setSkillImportVerifyLoading(false);
    }
  }

  async function verifyPendingPackagesFromImport(): Promise<void> {
    if (!skillImportResult) return;
    if (autoAssessVerifiedOnImport) {
      await certifyImportedSkillsFromImport(skillImportResult);
      return;
    }
    await verifyPendingSkillPackageIds(pendingImportPackageIds);
  }

  async function refreshAgentGrowthViews(agent_id: string): Promise<void> {
    const [trustRes, skillsRes, assessmentsRes] = await Promise.all([
      getAgentTrust(agent_id),
      listAgentSkills({ agent_id, limit: 50 }),
      listAgentSkillAssessments({ agent_id, limit: 100 }),
    ]);
    setTrust(trustRes);
    setSkills(skillsRes);
    setAssessments(assessmentsRes);
    await reloadApprovalRecommendation(agent_id);
  }

  async function assessImportedSkillsFromImport(
    baseResult?: AgentSkillImportResponseV1,
    opts?: { clearPrevious?: boolean },
  ): Promise<void> {
    const agent_id = agentId.trim();
    const importResult = baseResult ?? skillImportResult;
    if (!agent_id || !importResult) return;
    const clearPrevious = opts?.clearPrevious ?? true;

    setSkillImportAssessLoading(true);
    setSkillImportAssessError(null);
    if (clearPrevious) setSkillImportAssessResult(null);
    try {
      const actor_id = operatorActorId.trim() || "anon";
      const actor_principal_id = await ensureOperatorPrincipalId();
      const assessed = await assessImportedAgentSkills(agent_id, {
        actor_type: "user",
        actor_id,
        actor_principal_id,
        only_unassessed: true,
        limit: 200,
      });
      setSkillImportAssessResult(assessed);
      await refreshAgentGrowthViews(agent_id);
      await reloadOnboardingStatus(agent_id);
    } catch (e) {
      setSkillImportAssessError(toErrorCode(e));
    } finally {
      setSkillImportAssessLoading(false);
    }
  }

  async function certifyImportedSkillsFromImport(baseResult?: AgentSkillImportResponseV1): Promise<void> {
    const agent_id = agentId.trim();
    const importResult = baseResult ?? skillImportResult;
    if (!agent_id || !importResult) return;

    setSkillImportError(null);
    setSkillImportVerifyLoading(true);
    setSkillImportVerifyErrors([]);
    setSkillImportVerifyProgress(null);
    setSkillImportAssessLoading(true);
    setSkillImportAssessError(null);
    setSkillImportAssessResult(null);

    try {
      const actor_id = operatorActorId.trim() || "anon";
      const principal_id = await ensureOperatorPrincipalId();
      const certified = await certifyImportedAgentSkills(agent_id, {
        actor_type: "user",
        actor_id,
        principal_id,
        actor_principal_id: principal_id,
        only_unassessed: true,
        limit: 200,
      });

      const statusById = new Map(certified.review.items.map((item) => [item.skill_package_id, item.status] as const));
      setSkillImportResult((prev) => {
        const current = prev ?? importResult;
        const items = current.items.map((it) => {
          const nextStatus = statusById.get(it.skill_package_id);
          return nextStatus ? { ...it, status: nextStatus } : it;
        });
        const summary = {
          total: items.length,
          verified: items.filter((it) => it.status === "verified").length,
          pending: items.filter((it) => it.status === "pending").length,
          quarantined: items.filter((it) => it.status === "quarantined").length,
        };
        return { summary, items };
      });

      setSkillImportVerifyProgress({
        done: certified.review.summary.total,
        total: certified.review.summary.total,
      });
      setSkillImportVerifyErrors(
        certified.review.items
          .filter((item) => item.status === "quarantined")
          .map((item) => ({
            skill_package_id: item.skill_package_id,
            error_code: item.reason ?? "quarantined",
          })),
      );
      setSkillImportAssessResult(certified.assess);

      await reloadSkillPackages();
      await refreshAgentGrowthViews(agent_id);
      await reloadOnboardingStatus(agent_id);
    } catch (e) {
      setSkillImportError(toErrorCode(e));
      setSkillImportAssessError(toErrorCode(e));
    } finally {
      setSkillImportVerifyLoading(false);
      setSkillImportAssessLoading(false);
    }
  }

  useEffect(() => {
    void reloadSkillPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectNextAgentWithOnboardingWork(): void {
    if (!agents.length) return;
    const currentIdx = agents.findIndex((agent) => agent.agent_id === agentId);
    for (let offset = 1; offset <= agents.length; offset += 1) {
      const nextIdx = (Math.max(currentIdx, -1) + offset) % agents.length;
      const candidate = agents[nextIdx];
      if ((agentOnboardingWorkById[candidate.agent_id] ?? 0) <= 0) continue;
      setAgentId(candidate.agent_id);
      return;
    }
  }

  useEffect(() => {
    let cancelled = false;
    setActionRegistryLoading(true);
    setActionRegistryError(null);

    void (async () => {
      try {
        const rows = await listActionRegistry();
        if (cancelled) return;
        setActionRegistryRows(rows);
      } catch (e) {
        if (cancelled) return;
        setActionRegistryError(toErrorCode(e));
      } finally {
        if (!cancelled) setActionRegistryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void reloadChangeEvents(agentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, principalId]);

  const agentOptions = useMemo(() => {
    return agents.map((a) => ({
      value: a.agent_id,
      label: `${a.display_name} (${a.agent_id})${
        (agentOnboardingWorkById[a.agent_id] ?? 0) > 0
          ? t("agent_profile.agent_option.work_suffix", {
              count: agentOnboardingWorkById[a.agent_id] ?? 0,
            })
          : ""
      }`,
    }));
  }, [agents, agentOnboardingWorkById, t]);

  return (
    <section className="page">
      <div className="pageHeader">
        <h1 className="pageTitle">{t("page.agent_profile.title")}</h1>
        <div className="timelineControls">
          <button
            type="button"
            className="ghostButton"
            onClick={() => {
              void (async () => {
                setAgentsLoading(true);
                setAgentsError(null);
                try {
                  const res = await listRegisteredAgents({ limit: 200 });
                  setAgents(res);
                } catch (e) {
                  setAgentsError(toErrorCode(e));
                } finally {
                  setAgentsLoading(false);
                }
              })();
            }}
            disabled={agentsLoading}
          >
            {t("common.refresh")}
          </button>
        </div>
      </div>

      <div className="timelineTopBar">
        <div className="timelineRoomPicker">
          <label className="fieldLabel" htmlFor="agentSelect">
            {t("agent_profile.agent")}
          </label>

          <div className="timelineRoomRow">
            <select
              id="agentSelect"
              className="select"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">{t("agent_profile.agent_select_placeholder")}</option>
              {agentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghostButton"
              disabled={agentsWithOnboardingWork === 0}
              onClick={() => {
                selectNextAgentWithOnboardingWork();
              }}
            >
              {t("agent_profile.next_onboarding_agent")}
            </button>
            <button
              type="button"
              className="ghostButton"
              onClick={() => {
                const next = manualAgentId.trim();
                if (!next) return;
                setAgentId(next);
                setManualAgentId("");
              }}
            >
              {t("agent_profile.use_agent_id")}
            </button>
          </div>

          <div className="timelineManualRow">
            <input
              className="textInput"
              value={manualAgentId}
              onChange={(e) => setManualAgentId(e.target.value)}
              placeholder={t("agent_profile.agent_id_placeholder")}
            />
            <button
              type="button"
              className="ghostButton"
              onClick={() => {
                const next = manualAgentId.trim();
                if (!next) return;
                setAgentId(next);
                setManualAgentId("");
              }}
            >
              {t("agent_profile.use_agent_id")}
            </button>
          </div>

          {agentsError ? <div className="errorBox">{t("error.load_failed", { code: agentsError })}</div> : null}
          {agentOnboardingWorkError ? (
            <div className="errorBox">{t("error.load_failed", { code: agentOnboardingWorkError })}</div>
          ) : null}
          {agentsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
          {agentOnboardingWorkLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
          {!agentOnboardingWorkLoading && agentsWithOnboardingWork > 0 ? (
            <div className="muted">
              {t("agent_profile.onboarding_agents_pending", { count: agentsWithOnboardingWork })}
            </div>
          ) : null}
        </div>

        <div className="timelineConnection">
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("agent_profile.agent_id")}</div>
            <div className="mono">{agentId || "—"}</div>
          </div>
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("agent_profile.principal_id")}</div>
            <div className="mono">{principalId ?? "—"}</div>
          </div>
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("agent_profile.trust_score")}</div>
            <div className="mono">{trust ? trust.trust_score.toFixed(3) : "—"}</div>
          </div>
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("agent_profile.autonomy_rate_7d")}</div>
            <div className="mono">{latestSnapshot ? formatPct01(latestSnapshot.autonomy_rate_7d) : "—"}</div>
          </div>
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("agent_profile.quarantine")}</div>
            <div className="mono">
              {agentMetaLoading
                ? t("common.loading")
                : agentMetaError
                  ? t("error.load_failed", { code: agentMetaError })
                  : agentMeta
                    ? isQuarantined
                      ? t("agent_profile.quarantine.active")
                      : t("agent_profile.quarantine.inactive")
                    : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={tab.key === activeTab ? "tab tabActive" : "tab"}
            onClick={() => setActiveTab(tab.key)}
            aria-pressed={tab.key === activeTab}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "permissions" ? (
        <div className="agentProfileGrid">
          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.capabilities")}</div>
              <div className="muted">
                {t("agent_profile.tokens_active", { active: activeTokens.length, total: tokens.length })}
              </div>
            </div>

            {principalId == null ? <div className="placeholder">{t("agent_profile.principal_missing")}</div> : null}
            {tokensError ? <div className="errorBox">{t("error.load_failed", { code: tokensError })}</div> : null}
            {tokensLoading ? <div className="placeholder">{t("common.loading")}</div> : null}

            {!tokensLoading && principalId && !tokensError && tokens.length === 0 ? (
              <div className="placeholder">{t("agent_profile.tokens_empty")}</div>
            ) : null}

            {tokens.length ? (
              <div className="kvGrid">
                <div className="kvKey">{t("agent_profile.scope.rooms")}</div>
                <div className="kvVal">
                  <span className="mono">{scopeUnion.rooms.length}</span>
                  {scopeUnion.rooms.length ? <span className="muted"> · {scopeUnion.rooms.join(", ")}</span> : null}
                </div>

                <div className="kvKey">{t("agent_profile.scope.tools")}</div>
                <div className="kvVal">
                  <span className="mono">{scopeUnion.tools.length}</span>
                  {scopeUnion.tools.length ? <span className="muted"> · {scopeUnion.tools.join(", ")}</span> : null}
                </div>

                <div className="kvKey">{t("agent_profile.scope.data_read")}</div>
                <div className="kvVal">
                  <span className="mono">{scopeUnion.dataRead.length}</span>
                  {scopeUnion.dataRead.length ? <span className="muted"> · {scopeUnion.dataRead.join(", ")}</span> : null}
                </div>

                <div className="kvKey">{t("agent_profile.scope.data_write")}</div>
                <div className="kvVal">
                  <span className="mono">{scopeUnion.dataWrite.length}</span>
                  {scopeUnion.dataWrite.length ? <span className="muted"> · {scopeUnion.dataWrite.join(", ")}</span> : null}
                </div>

                <div className="kvKey">{t("agent_profile.scope.egress")}</div>
                <div className="kvVal">
                  <span className="mono">{scopeUnion.egress.length}</span>
                  {scopeUnion.egress.length ? <span className="muted"> · {scopeUnion.egress.join(", ")}</span> : null}
                </div>

                <div className="kvKey">{t("agent_profile.scope.actions")}</div>
                <div className="kvVal">
                  <span className="mono">{scopeUnion.actions.length}</span>
                  {scopeUnion.actions.length ? <span className="muted"> · {scopeUnion.actions.join(", ")}</span> : null}
                </div>
              </div>
            ) : null}

            {tokens.length ? (
              <div className="detailSection">
                <div className="detailSectionTitle">{t("agent_profile.permissions_matrix")}</div>
                <div className="permissionMatrix">
                  {permissionMatrix.map((row) => (
                    <div key={row.key} className="permissionRow">
                      <div className="permissionLabel">{row.label}</div>
                      <div className="permissionMeta mono">
                        {t("agent_profile.scope_count", { count: row.scopeCount })}
                      </div>
                      <span className={statePillClass(row.state)}>{t(`agent_profile.permission.state.${row.state}`)}</span>
                    </div>
                  ))}
                </div>

                <div className="detailSectionTitle">{t("agent_profile.zone_ring")}</div>
                <div className="zoneRing">
                  {zoneRing.map((zone) => (
                    <div key={zone.key} className="zoneChip">
                      <span className="mono">{zone.label}</span>
                      <span className={statePillClass(zone.state)}>{t(`agent_profile.zone.state.${zone.state}`)}</span>
                    </div>
                  ))}
                </div>

                <div className="detailSectionTitle">{t("agent_profile.approval_recommendation")}</div>
                <div className="timelineControls" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="ghostButton"
                    disabled={approvalRecommendationLoading || !agentId.trim()}
                    onClick={() => void reloadApprovalRecommendation()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                {approvalRecommendationLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
                {approvalRecommendationError ? (
                  <div className="muted">{t("error.load_failed", { code: approvalRecommendationError })}</div>
                ) : null}
                <div className="permissionMatrix">
                  {approvalRecommendations.map((row) => (
                    <div key={row.key} className="permissionRow">
                      <div className="permissionLabel">{row.label}</div>
                      <div className="permissionMeta">{row.basis}</div>
                      <span className={statePillClass(row.mode)}>{t(`agent_profile.approval.mode.${row.mode}`)}</span>
                    </div>
                  ))}
                </div>

                <div className="detailSectionTitle">{t("agent_profile.approval.signals")}</div>
                <div className="kvGrid">
                  <div className="kvKey">{t("agent_profile.approval.signal.assessment_failed_7d")}</div>
                  <div className="kvVal mono">{approvalAssessmentSignals.failed7d}</div>

                  <div className="kvKey">{t("agent_profile.approval.signal.assessment_completed_30d")}</div>
                  <div className="kvVal mono">{approvalAssessmentSignals.completed30d}</div>

                  <div className="kvKey">{t("agent_profile.approval.signal.assessment_pass_rate_30d")}</div>
                  <div className="kvVal mono">{formatPct01OrDash(approvalAssessmentSignals.passRate30d)}</div>

                  <div className="kvKey">{t("agent_profile.approval.signal.risk")}</div>
                  <div className="kvVal">
                    <span className={statePillClass(approvalAssessmentRiskTrend)}>
                      {approvalAssessmentRiskElevated
                        ? t("agent_profile.approval.signal.risk.elevated")
                        : t("agent_profile.approval.signal.risk.low")}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ tokens }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.action_registry")}</div>
              <button
                type="button"
                className="ghostButton"
                disabled={actionRegistryLoading}
                onClick={() => {
                  void (async () => {
                    setActionRegistryLoading(true);
                    setActionRegistryError(null);
                    try {
                      const rows = await listActionRegistry();
                      setActionRegistryRows(rows);
                    } catch (e) {
                      setActionRegistryError(toErrorCode(e));
                    } finally {
                      setActionRegistryLoading(false);
                    }
                  })();
                }}
              >
                {t("common.refresh")}
              </button>
            </div>

            {actionRegistryError ? (
              <div className="errorBox">{t("error.load_failed", { code: actionRegistryError })}</div>
            ) : null}
            {actionRegistryLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
            {!actionRegistryLoading && !actionRegistryError && actionRegistryRows.length === 0 ? (
              <div className="placeholder">{t("common.not_available")}</div>
            ) : null}

            {actionRegistryRows.length ? (
              <div className="tableWrap">
                <table className="dataTable">
                  <thead>
                    <tr>
                      <th>{t("agent_profile.action_registry.action")}</th>
                      <th>{t("agent_profile.action_registry.reversible")}</th>
                      <th>{t("agent_profile.action_registry.zone_required")}</th>
                      <th>{t("agent_profile.action_registry.cost_impact")}</th>
                      <th>{t("agent_profile.action_registry.recovery_difficulty")}</th>
                      <th>{t("agent_profile.action_registry.pre_approval")}</th>
                      <th>{t("agent_profile.action_registry.post_review")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionRegistryRows.slice(0, 30).map((row) => {
                      const costImpact = actionCostImpact(row);
                      const recoveryDifficulty = actionRecoveryDifficulty(row);
                      return (
                        <tr key={row.action_type}>
                          <td className="mono">{row.action_type}</td>
                          <td className="mono">{row.reversible ? t("common.yes") : t("common.no")}</td>
                          <td className="mono">{row.zone_required}</td>
                          <td>{t(`agent_profile.action_registry.cost.${costImpact}`)}</td>
                          <td>{t(`agent_profile.action_registry.recovery.${recoveryDifficulty}`)}</td>
                          <td className="mono">{row.requires_pre_approval ? t("common.yes") : t("common.no")}</td>
                          <td className="mono">{row.post_review_required ? t("common.yes") : t("common.no")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ actions: actionRegistryRows }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.autonomy_upgrade")}</div>
            </div>

            <div className="detailSection">
              <label className="fieldLabel" htmlFor="operatorActorId">
                {t("agent_profile.autonomy.operator_actor_id")}
              </label>
              <input
                id="operatorActorId"
                className="textInput mono"
                value={operatorActorId}
                onChange={(e) => setOperatorActorId(e.target.value)}
                placeholder={t("agent_profile.autonomy.operator_actor_id_placeholder")}
                disabled={autonomyRecommendLoading || autonomyApproveLoading}
              />
            </div>

            <div className="timelineControls" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primaryButton"
                disabled={autonomyRecommendLoading || autonomyApproveLoading || !agentId.trim()}
                onClick={() => {
                  void (async () => {
                    const nextAgentId = agentId.trim();
                    if (!nextAgentId) return;

                    setAutonomyRecommendLoading(true);
                    setAutonomyRecommendError(null);
                    setAutonomyApproveError(null);
                    setAutonomyApproveResult(null);

                    try {
                      const actor_id = operatorActorId.trim() || "anon";
                      const operator_principal_id = await ensureOperatorPrincipalId();
                      const res = await recommendAutonomyUpgrade(nextAgentId, {
                        actor_type: "user",
                        actor_id,
                        actor_principal_id: operator_principal_id,
                      });

                      setAutonomyRecommendation(res.recommendation);
                      setAutonomyRecommendationId(res.recommendation.recommendation_id);
                      setTrust(res.trust);
                      await reloadApprovalRecommendation(nextAgentId);
                    } catch (e) {
                      setAutonomyRecommendError(toErrorCode(e));
                    } finally {
                      setAutonomyRecommendLoading(false);
                    }
                  })();
                }}
              >
                {t("agent_profile.autonomy.button_recommend")}
              </button>

              <button
                type="button"
                className="ghostButton"
                disabled={autonomyRecommendLoading || autonomyApproveLoading}
                onClick={() => {
                  setAutonomyRecommendation(null);
                  setAutonomyRecommendationId("");
                  setAutonomyRecommendError(null);
                  setAutonomyApproveError(null);
                  setAutonomyApproveResult(null);
                }}
              >
                {t("common.reset")}
              </button>
            </div>

            {autonomyRecommendError ? (
              <div className="errorBox" style={{ marginTop: 10 }}>
                {t("error.load_failed", { code: autonomyRecommendError })}
              </div>
            ) : null}

            {autonomyRecommendLoading ? <div className="placeholder">{t("common.loading")}</div> : null}

            {!autonomyRecommendLoading && !autonomyRecommendError && !autonomyRecommendation ? (
              <div className="placeholder">{t("agent_profile.autonomy.no_recommendation")}</div>
            ) : null}

            {autonomyRecommendation ? (
              <div className="kvGrid" style={{ marginTop: 10 }}>
                <div className="kvKey">{t("agent_profile.autonomy.recommendation_id")}</div>
                <div className="kvVal mono">{autonomyRecommendation.recommendation_id}</div>

                <div className="kvKey">{t("agent_profile.autonomy.rationale")}</div>
                <div className="kvVal">{autonomyRecommendation.rationale}</div>
              </div>
            ) : null}

            <div className="detailSection">
              <label className="fieldLabel" htmlFor="autonomyRecommendationId">
                {t("agent_profile.autonomy.recommendation_id")}
              </label>
              <input
                id="autonomyRecommendationId"
                className="textInput mono"
                value={autonomyRecommendationId}
                onChange={(e) => setAutonomyRecommendationId(e.target.value)}
                placeholder={t("agent_profile.autonomy.recommendation_id_placeholder")}
                disabled={autonomyRecommendLoading || autonomyApproveLoading}
              />
            </div>

            <div className="timelineControls" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primaryButton"
                disabled={
                  autonomyApproveLoading ||
                  autonomyRecommendLoading ||
                  !agentId.trim() ||
                  !autonomyRecommendationId.trim()
                }
                onClick={() => {
                  void (async () => {
                    const nextAgentId = agentId.trim();
                    const recommendation_id = autonomyRecommendationId.trim();
                    if (!nextAgentId || !recommendation_id) return;

                    setAutonomyApproveLoading(true);
                    setAutonomyApproveError(null);
                    setAutonomyApproveResult(null);
                    try {
                      const granted_by_principal_id = await ensureOperatorPrincipalId();
                      const res = await approveAutonomyUpgrade(nextAgentId, {
                        recommendation_id,
                        granted_by_principal_id,
                      });
                      setAutonomyApproveResult(res);
                      await reloadTokens();
                      await reloadApprovalRecommendation(nextAgentId);
                    } catch (e) {
                      setAutonomyApproveError(toErrorCode(e));
                    } finally {
                      setAutonomyApproveLoading(false);
                    }
                  })();
                }}
              >
                {t("agent_profile.autonomy.button_approve")}
              </button>
            </div>

            {autonomyApproveError ? (
              <div className="errorBox" style={{ marginTop: 10 }}>
                {t("error.load_failed", { code: autonomyApproveError })}
              </div>
            ) : null}
            {autonomyApproveLoading ? <div className="placeholder">{t("common.loading")}</div> : null}

            {autonomyApproveResult ? (
              <div className="kvGrid" style={{ marginTop: 10 }}>
                <div className="kvKey">{t("agent_profile.autonomy.token_id")}</div>
                <div className="kvVal mono">{autonomyApproveResult.token_id}</div>

                <div className="kvKey">{t("agent_profile.autonomy.status")}</div>
                <div className="kvVal">
                  {autonomyApproveResult.already_approved
                    ? t("agent_profile.autonomy.already_approved")
                    : t("agent_profile.autonomy.approved")}
                </div>
              </div>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ recommendation: autonomyRecommendation, approve_result: autonomyApproveResult }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.delegation")}</div>
            </div>

            {!tokens.length ? <div className="placeholder">{t("agent_profile.tokens_empty")}</div> : null}

            {tokens.length ? (
              <>
                <div className="kvGrid" style={{ marginBottom: 10 }}>
                  <div className="kvKey">{t("agent_profile.delegation.max_depth")}</div>
                  <div className="kvVal mono">{delegationSummary.maxDepth}</div>

                  <div className="kvKey">{t("agent_profile.delegation.root_tokens")}</div>
                  <div className="kvVal mono">{delegationSummary.rootTokens}</div>

                  <div className="kvKey">{t("agent_profile.delegation.delegated_tokens")}</div>
                  <div className="kvVal mono">{delegationSummary.delegatedTokens}</div>
                </div>

                <ul className="agentChainList">
                  <li className="agentChainRow">
                    <div className="detailSectionTitle">{t("agent_profile.delegation.graph")}</div>
                    {!delegationRows.length ? (
                      <div className="placeholder">{t("agent_profile.tokens_empty")}</div>
                    ) : (
                      <ul className="delegationGraphList">
                        {delegationRows.map((row) => (
                          <li key={row.token_id} className="delegationGraphRow">
                            <div className="delegationGraphTop">
                              <span className="mono">{`${"· ".repeat(Math.min(row.depth, 8))}${row.token_id}`}</span>
                              <span className={row.active ? "statusPill statusApproved" : "statusPill statusHeld"}>
                                {row.active ? t("agent_profile.token.active") : t("agent_profile.token.inactive")}
                              </span>
                            </div>
                            <div className="delegationGraphMeta muted">
                              <span className="mono">
                                {t("agent_profile.delegation.depth")}: {row.depth}
                              </span>
                              {row.parent_token_id ? (
                                <span className="mono">
                                  {t("agent_profile.token.parent")}: {row.parent_token_id}
                                </span>
                              ) : (
                                <span className="muted">{t("agent_profile.token.no_parent")}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>

                  {tokens.slice(0, 20).map((tok) => (
                    <li key={tok.token_id} className="agentChainRow">
                      <div className="agentChainTop">
                        <span className="mono">{tok.token_id}</span>
                        <span className={isTokenActive(tok) ? "statusPill statusApproved" : "statusPill statusHeld"}>
                          {isTokenActive(tok) ? t("agent_profile.token.active") : t("agent_profile.token.inactive")}
                        </span>
                      </div>
                      <div className="agentChainMeta muted">
                        {tok.parent_token_id ? (
                          <span className="mono">
                            {t("agent_profile.token.parent")}: {tok.parent_token_id}
                          </span>
                        ) : (
                          <span className="muted">{t("agent_profile.token.no_parent")}</span>
                        )}
                        <span className="muted">
                          {t("agent_profile.token.created")}: {formatTimestamp(tok.created_at)}
                        </span>
                        {tok.valid_until ? (
                          <span className="muted">
                            {t("agent_profile.token.valid_until")}: {formatTimestamp(tok.valid_until)}
                          </span>
                        ) : null}
                        {tok.revoked_at ? (
                          <span className="muted">
                            {t("agent_profile.token.revoked_at")}: {formatTimestamp(tok.revoked_at)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.onboarding")}</div>
            </div>

            <div className="detailSection">
              <div className="detailSectionTitle">{t("agent_profile.onboarding.status_title")}</div>
              <div className="timelineControls" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="ghostButton"
                  disabled={onboardingStatusLoading || onboardingCertifyLoading || !agentId.trim()}
                  onClick={() => void reloadOnboardingStatus()}
                >
                  {t("common.refresh")}
                </button>
                <button
                  type="button"
                  className="primaryButton"
                  disabled={
                    onboardingStatusLoading ||
                    onboardingCertifyLoading ||
                    skillImportLoading ||
                    skillImportVerifyLoading ||
                    skillImportAssessLoading ||
                    !agentId.trim() ||
                    !onboardingNeedsCertify
                  }
                  onClick={() => void certifyImportedSkillsFromStatus()}
                >
                  {t("agent_profile.onboarding.button_certify_status")}
                </button>
              </div>

              {onboardingStatusError ? (
                <div className="errorBox" style={{ marginTop: 10 }}>
                  {t("error.load_failed", { code: onboardingStatusError })}
                </div>
              ) : null}
              {onboardingCertifyError ? (
                <div className="errorBox" style={{ marginTop: 10 }}>
                  {t("error.load_failed", { code: onboardingCertifyError })}
                </div>
              ) : null}
              {onboardingCertifyLoading ? (
                <div className="placeholder" style={{ marginTop: 10 }}>
                  {t("agent_profile.onboarding.status_action_loading")}
                </div>
              ) : null}
              {onboardingCertifyResult ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  {t("agent_profile.onboarding.status_action_summary_line", {
                    review_total: onboardingCertifyResult.review.summary.total,
                    review_verified: onboardingCertifyResult.review.summary.verified,
                    review_quarantined: onboardingCertifyResult.review.summary.quarantined,
                    candidates: onboardingCertifyResult.assess.summary.total_candidates,
                    assessed: onboardingCertifyResult.assess.summary.assessed,
                    skipped: onboardingCertifyResult.assess.summary.skipped,
                  })}
                </div>
              ) : null}

              {!agentId.trim() ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  {t("common.not_available")}
                </div>
              ) : onboardingStatusLoading ? (
                <div className="placeholder" style={{ marginTop: 10 }}>
                  {t("common.loading")}
                </div>
              ) : onboardingStatus ? (
                <div className="kvGrid" style={{ marginTop: 10 }}>
                  <div className="kvKey">{t("agent_profile.onboarding.status.total_linked")}</div>
                  <div className="kvVal mono">{onboardingStatus.summary.total_linked}</div>

                  <div className="kvKey">{t("agent_profile.onboarding.status.verified")}</div>
                  <div className="kvVal mono">{onboardingStatus.summary.verified}</div>

                  <div className="kvKey">{t("agent_profile.onboarding.status.verified_skills")}</div>
                  <div className="kvVal mono">{onboardingStatus.summary.verified_skills}</div>

                  <div className="kvKey">{t("agent_profile.onboarding.status.pending")}</div>
                  <div className="kvVal mono">{onboardingStatus.summary.pending}</div>

                  <div className="kvKey">{t("agent_profile.onboarding.status.quarantined")}</div>
                  <div className="kvVal mono">{onboardingStatus.summary.quarantined}</div>

                  <div className="kvKey">{t("agent_profile.onboarding.status.verified_assessed")}</div>
                  <div className="kvVal mono">{onboardingStatus.summary.verified_assessed}</div>

                  <div className="kvKey">{t("agent_profile.onboarding.status.verified_unassessed")}</div>
                  <div className="kvVal mono">{onboardingStatus.summary.verified_unassessed}</div>
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 10 }}>
                  {t("common.not_available")}
                </div>
              )}
              {agentId.trim() && onboardingStatus && !onboardingNeedsCertify ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  {t("agent_profile.onboarding.status.no_pending_work")}
                </div>
              ) : null}
            </div>

            <div className="detailSectionTitle">{t("agent_profile.onboarding.register_title")}</div>

            <label className="fieldLabel" htmlFor="registerDisplayName">
              {t("agent_profile.onboarding.display_name")}
            </label>
            <div className="timelineManualRow">
              <input
                id="registerDisplayName"
                className="textInput"
                value={registerDisplayName}
                onChange={(e) => setRegisterDisplayName(e.target.value)}
                placeholder={t("agent_profile.onboarding.display_name_placeholder")}
                disabled={registerLoading}
              />
              <button
                type="button"
                className="primaryButton"
                disabled={registerLoading || !registerDisplayName.trim()}
                onClick={() => {
                  void (async () => {
                    const display_name = registerDisplayName.trim();
                    if (!display_name) return;
                    setRegisterLoading(true);
                    setRegisterError(null);
                    try {
                      const res = await registerAgent({ display_name });
                      setRegisterDisplayName("");
                      setAgentId(res.agent_id);

                      setAgentsLoading(true);
                      setAgentsError(null);
                      const list = await listRegisteredAgents({ limit: 200 });
                      setAgents(list);
                    } catch (e) {
                      setRegisterError(toErrorCode(e));
                    } finally {
                      setAgentsLoading(false);
                      setRegisterLoading(false);
                    }
                  })();
                }}
              >
                {t("agent_profile.onboarding.button_register")}
              </button>
            </div>

            {registerError ? <div className="errorBox">{t("error.load_failed", { code: registerError })}</div> : null}

            <div className="detailSection">
              <div className="detailSectionTitle">{t("agent_profile.onboarding.import_title")}</div>

              <label className="fieldLabel" htmlFor="skillImportJson">
                {t("agent_profile.onboarding.import_json")}
              </label>
              <textarea
                id="skillImportJson"
                className="textInput mono"
                rows={8}
                value={skillImportJson}
                onChange={(e) => setSkillImportJson(e.target.value)}
                placeholder={t("agent_profile.onboarding.import_json_placeholder")}
                disabled={skillImportLoading}
              />

              <div className="timelineControls" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="primaryButton"
                  disabled={skillImportLoading || !agentId.trim() || !skillImportJson.trim()}
                  onClick={() => {
                    void (async () => {
                      const nextAgentId = agentId.trim();
                      if (!nextAgentId) return;
                      setSkillImportLoading(true);
                      setSkillImportError(null);
                      setSkillImportResult(null);
                      setSkillImportAssessError(null);
                      setSkillImportAssessResult(null);
                      setSkillImportAssessLoading(false);
                      setSkillImportVerifyErrors([]);
                      setSkillImportVerifyProgress(null);
                      setSkillImportVerifyLoading(false);
                      try {
                        const raw = skillImportJson.trim();
                        let parsed: unknown;
                        try {
                          parsed = JSON.parse(raw) as unknown;
                        } catch {
                          setSkillImportError("invalid_json");
                          return;
                        }

                        let packages: unknown = parsed;
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                          const obj = parsed as Record<string, unknown>;
                          if (Array.isArray(obj.packages)) packages = obj.packages;
                        }
                        if (!Array.isArray(packages)) {
                          setSkillImportError("invalid_shape");
                          return;
                        }

                        if (autoVerifyPendingOnImport && autoAssessVerifiedOnImport) {
                          const actor_id = operatorActorId.trim() || "anon";
                          const principal_id = await ensureOperatorPrincipalId();
                          const flow = await importAndCertifyAgentSkills(nextAgentId, {
                            packages: packages as any[],
                            actor_type: "user",
                            actor_id,
                            principal_id,
                            actor_principal_id: principal_id,
                            only_unassessed: true,
                            limit: 200,
                          });

                          const statusById = new Map(
                            flow.certify.review.items.map((item) => [item.skill_package_id, item.status] as const),
                          );
                          const items = flow.import.items.map((it) => {
                            const nextStatus = statusById.get(it.skill_package_id);
                            return nextStatus ? { ...it, status: nextStatus } : it;
                          });
                          const summary = {
                            total: items.length,
                            verified: items.filter((it) => it.status === "verified").length,
                            pending: items.filter((it) => it.status === "pending").length,
                            quarantined: items.filter((it) => it.status === "quarantined").length,
                          };
                          setSkillImportResult({ summary, items });
                          setSkillImportVerifyProgress({
                            done: flow.certify.review.summary.total,
                            total: flow.certify.review.summary.total,
                          });
                          setSkillImportVerifyErrors(
                            flow.certify.review.items
                              .filter((item) => item.status === "quarantined")
                              .map((item) => ({
                                skill_package_id: item.skill_package_id,
                                error_code: item.reason ?? "quarantined",
                              })),
                          );
                          setSkillImportAssessResult(flow.certify.assess);
                          await reloadSkillPackages();
                          await refreshAgentGrowthViews(nextAgentId);
                          await reloadOnboardingStatus(nextAgentId);
                        } else {
                          const res = await importAgentSkills(nextAgentId, { packages: packages as any[] });
                          setSkillImportResult(res);
                          await reloadSkillPackages();
                          await reloadOnboardingStatus(nextAgentId);

                          if (autoVerifyPendingOnImport) {
                            const pendingIds = res.items
                              .filter((it) => it.status === "pending")
                              .map((it) => it.skill_package_id);
                            if (pendingIds.length > 0) {
                              await verifyPendingSkillPackageIds(pendingIds, res);
                            } else if (autoAssessVerifiedOnImport && res.summary.verified > 0) {
                              await assessImportedSkillsFromImport(res, { clearPrevious: true });
                            }
                          } else if (autoAssessVerifiedOnImport && res.summary.verified > 0) {
                            await assessImportedSkillsFromImport(res, { clearPrevious: true });
                          }
                        }
                      } catch (e) {
                        setSkillImportError(toErrorCode(e));
                      } finally {
                        setSkillImportLoading(false);
                      }
                    })();
                  }}
                >
                  {t("agent_profile.onboarding.button_import")}
                </button>
                <button
                  type="button"
                  className="ghostButton"
                  disabled={skillImportLoading}
                  onClick={() => {
                    setSkillImportJson("");
                    setSkillImportError(null);
                    setSkillImportResult(null);
                    setSkillImportAssessError(null);
                    setSkillImportAssessResult(null);
                    setSkillImportAssessLoading(false);
                    setSkillImportVerifyErrors([]);
                    setSkillImportVerifyProgress(null);
                    setSkillImportVerifyLoading(false);
                  }}
                >
                  {t("common.reset")}
                </button>
              </div>

              <label className="checkRow" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={autoVerifyPendingOnImport}
                  onChange={(e) => setAutoVerifyPendingOnImport(e.target.checked)}
                  disabled={skillImportLoading || skillImportVerifyLoading || skillImportAssessLoading}
                />
                <span>{t("agent_profile.onboarding.auto_verify_pending")}</span>
              </label>

              <label className="checkRow" style={{ marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={autoAssessVerifiedOnImport}
                  onChange={(e) => setAutoAssessVerifiedOnImport(e.target.checked)}
                  disabled={skillImportLoading || skillImportVerifyLoading || skillImportAssessLoading}
                />
                <span>{t("agent_profile.onboarding.auto_assess_verified")}</span>
              </label>

              {skillImportError ? (
                <div className="errorBox" style={{ marginTop: 10 }}>
                  {skillImportError === "invalid_json"
                    ? t("agent_profile.onboarding.error.invalid_json")
                    : skillImportError === "invalid_shape"
                      ? t("agent_profile.onboarding.error.invalid_shape")
                      : t("error.load_failed", { code: skillImportError })}
                </div>
              ) : null}

              {skillImportLoading ? <div className="placeholder">{t("common.loading")}</div> : null}

              {skillImportResult ? (
                <>
                  <div className="kvGrid" style={{ marginTop: 10 }}>
                    <div className="kvKey">{t("agent_profile.onboarding.import_summary")}</div>
                    <div className="kvVal mono">
                      {t("agent_profile.onboarding.import_summary_line", {
                        total: skillImportResult.summary.total,
                        verified: skillImportResult.summary.verified,
                        pending: skillImportResult.summary.pending,
                        quarantined: skillImportResult.summary.quarantined,
                      })}
                    </div>
                  </div>

                  <div className="detailSection" style={{ marginTop: 10 }}>
                    <div className="detailSectionTitle">{t("agent_profile.onboarding.review_title")}</div>

                    {pendingImportPackageIds.length === 0 ? (
                      <div className="muted">{t("agent_profile.onboarding.no_pending_from_import")}</div>
                    ) : (
                      <div className="muted">
                        {t("agent_profile.onboarding.pending_from_import", { count: pendingImportPackageIds.length })}
                      </div>
                    )}

                    <div className="timelineControls" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="primaryButton"
                        disabled={skillImportVerifyLoading || pendingImportPackageIds.length === 0}
                        onClick={() => void verifyPendingPackagesFromImport()}
                      >
                        {t("agent_profile.onboarding.button_verify_pending")}
                      </button>
                      <button
                        type="button"
                        className="ghostButton"
                        disabled={
                          skillImportVerifyLoading ||
                          skillImportAssessLoading ||
                          !skillImportResult ||
                          skillImportResult.summary.total === 0
                        }
                        onClick={() => void certifyImportedSkillsFromImport(skillImportResult)}
                      >
                        {t("agent_profile.onboarding.button_certify_imported")}
                      </button>
                      <button
                        type="button"
                        className="ghostButton"
                        disabled={
                          skillImportAssessLoading || skillImportVerifyLoading || skillImportResult.summary.verified === 0
                        }
                        onClick={() => void assessImportedSkillsFromImport()}
                      >
                        {t("agent_profile.onboarding.button_assess_verified")}
                      </button>
                    </div>

                    {skillImportVerifyProgress ? (
                      <div className="placeholder" style={{ marginTop: 10 }}>
                        {skillImportVerifyLoading
                          ? t("agent_profile.onboarding.verify_progress", {
                              done: skillImportVerifyProgress.done,
                              total: skillImportVerifyProgress.total,
                            })
                          : skillImportVerifyProgress.total > 0
                            ? t("agent_profile.onboarding.verify_done")
                            : ""}
                      </div>
                    ) : null}

                    {skillImportVerifyErrors.length ? (
                      <div className="errorBox" style={{ marginTop: 10 }}>
                        {t("agent_profile.onboarding.verify_errors", { count: skillImportVerifyErrors.length })}
                      </div>
                    ) : null}

                    {skillImportAssessLoading ? (
                      <div className="placeholder" style={{ marginTop: 10 }}>
                        {t("agent_profile.onboarding.assess_loading")}
                      </div>
                    ) : null}

                    {skillImportAssessError ? (
                      <div className="errorBox" style={{ marginTop: 10 }}>
                        {t("error.load_failed", { code: skillImportAssessError })}
                      </div>
                    ) : null}

                    {skillImportAssessResult ? (
                      <div className="muted" style={{ marginTop: 10 }}>
                        {t("agent_profile.onboarding.assess_summary_line", {
                          total: skillImportAssessResult.summary.total_candidates,
                          assessed: skillImportAssessResult.summary.assessed,
                          skipped: skillImportAssessResult.summary.skipped,
                        })}
                      </div>
                    ) : null}
                  </div>

                  <details className="advancedDetails">
                    <summary className="advancedSummary">{t("common.advanced")}</summary>
                    <JsonView
                      value={{
                        import_result: skillImportResult,
                        bulk_verify_errors: skillImportVerifyErrors,
                        bulk_assess_result: skillImportAssessResult,
                      }}
                    />
                  </details>
                </>
              ) : null}
            </div>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.quarantine")}</div>
              {agentMeta ? (
                <span className={isQuarantined ? "statusPill statusDenied" : "statusPill statusApproved"}>
                  {isQuarantined ? t("agent_profile.quarantine.active") : t("agent_profile.quarantine.inactive")}
                </span>
              ) : (
                <span className="connState">{t("common.not_available")}</span>
              )}
            </div>

            {agentMetaError ? <div className="errorBox">{t("error.load_failed", { code: agentMetaError })}</div> : null}
            {agentMetaLoading ? <div className="placeholder">{t("common.loading")}</div> : null}

            {!agentMetaLoading && !agentMetaError && agentMeta && isQuarantined ? (
              <div className="kvGrid">
                <div className="kvKey">{t("agent_profile.quarantine.at")}</div>
                <div className="kvVal mono">{formatTimestamp(agentMeta.quarantined_at ?? null)}</div>

                <div className="kvKey">{t("agent_profile.quarantine.reason")}</div>
                <div className="kvVal mono">{agentMeta.quarantine_reason ?? "—"}</div>
              </div>
            ) : null}

            {!agentMetaLoading && !agentMetaError && agentMeta && !isQuarantined ? (
              <div className="placeholder">{t("agent_profile.quarantine.not_quarantined_hint")}</div>
            ) : null}

            <div className="detailSection">
              <label className="fieldLabel" htmlFor="quarantineReason">
                {t("agent_profile.quarantine.reason")}
              </label>
              <div className="timelineManualRow">
                <input
                  id="quarantineReason"
                  className="textInput"
                  value={quarantineReason}
                  onChange={(e) => setQuarantineReason(e.target.value)}
                  placeholder={t("agent_profile.quarantine.reason_placeholder")}
                  disabled={quarantineActionLoading || isQuarantined}
                />
                <button
                  type="button"
                  className="dangerButton"
                  disabled={quarantineActionLoading || !agentId.trim() || isQuarantined}
                  onClick={() => {
                    void (async () => {
                      if (!agentId.trim()) return;
                      setQuarantineActionLoading(true);
                      setQuarantineActionError(null);
                      try {
                        await quarantineAgent(agentId, {
                          quarantine_reason: quarantineReason.trim() || undefined,
                        });
                        const meta = await getAgent(agentId);
                        setAgentMeta(meta);
                        await reloadApprovalRecommendation(agentId);
                      } catch (e) {
                        setQuarantineActionError(toErrorCode(e));
                      } finally {
                        setQuarantineActionLoading(false);
                      }
                    })();
                  }}
                >
                  {t("agent_profile.quarantine.button_quarantine")}
                </button>
              </div>

              <div className="timelineControls" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="ghostButton"
                  disabled={quarantineActionLoading || !agentId.trim() || !isQuarantined}
                  onClick={() => {
                    void (async () => {
                      if (!agentId.trim()) return;
                      setQuarantineActionLoading(true);
                      setQuarantineActionError(null);
                      try {
                        await unquarantineAgent(agentId);
                        const meta = await getAgent(agentId);
                        setAgentMeta(meta);
                        await reloadApprovalRecommendation(agentId);
                      } catch (e) {
                        setQuarantineActionError(toErrorCode(e));
                      } finally {
                        setQuarantineActionLoading(false);
                      }
                    })();
                  }}
                >
                  {t("agent_profile.quarantine.button_unquarantine")}
                </button>
                <span className="muted">{t("agent_profile.quarantine.note_egress_blocked")}</span>
              </div>

              {quarantineActionError ? (
                <div className="errorBox" style={{ marginTop: 10 }}>
                  {t("error.load_failed", { code: quarantineActionError })}
                </div>
              ) : null}

              <details className="advancedDetails">
                <summary className="advancedSummary">{t("common.advanced")}</summary>
                <JsonView value={{ agent: agentMeta }} />
              </details>
            </div>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.skill_packages")}</div>
              <button
                type="button"
                className="ghostButton"
                onClick={() => void reloadSkillPackages()}
                disabled={skillPackagesLoading}
              >
                {t("common.refresh")}
              </button>
            </div>

            <div className="kvGrid">
              <div className="kvKey">{t("agent_profile.skill_packages.filter.status")}</div>
              <div className="kvVal">
                <select
                  className="select"
                  value={skillPackagesStatus}
                  onChange={(e) => setSkillPackagesStatus(e.target.value as "all" | SkillVerificationStatus)}
                  disabled={skillPackagesLoading}
                >
                  <option value="all">{t("agent_profile.skill_packages.status.all")}</option>
                  <option value="pending">{t("agent_profile.skill_packages.status.pending")}</option>
                  <option value="verified">{t("agent_profile.skill_packages.status.verified")}</option>
                  <option value="quarantined">{t("agent_profile.skill_packages.status.quarantined")}</option>
                </select>
              </div>

              <div className="kvKey">{t("agent_profile.skill_packages.filter.skill_id")}</div>
              <div className="kvVal">
                <input
                  className="textInput"
                  value={skillPackagesSkillId}
                  onChange={(e) => setSkillPackagesSkillId(e.target.value)}
                  placeholder={t("agent_profile.skill_packages.skill_id_placeholder")}
                  disabled={skillPackagesLoading}
                />
              </div>

              <div className="kvKey">{t("agent_profile.skill_packages.filter.limit")}</div>
              <div className="kvVal">
                <input
                  className="textInput"
                  inputMode="numeric"
                  value={String(skillPackagesLimit)}
                  onChange={(e) => setSkillPackagesLimit(Number(e.target.value ?? "50"))}
                  disabled={skillPackagesLoading}
                />
              </div>
            </div>

            <div className="detailSection">
              <label className="fieldLabel" htmlFor="skillPkgQuarantineReason">
                {t("agent_profile.skill_packages.quarantine_reason")}
              </label>
              <input
                id="skillPkgQuarantineReason"
                className="textInput"
                value={skillPackagesQuarantineReason}
                onChange={(e) => setSkillPackagesQuarantineReason(e.target.value)}
                placeholder={t("agent_profile.skill_packages.quarantine_reason_placeholder")}
                disabled={skillPackagesLoading || Boolean(skillPackagesActionId)}
              />
            </div>

            {skillPackagesError ? <div className="errorBox">{t("error.load_failed", { code: skillPackagesError })}</div> : null}
            {skillPackagesLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
            {!skillPackagesLoading && !skillPackagesError && skillPackages.length === 0 ? (
              <div className="placeholder">{t("agent_profile.skill_packages.empty")}</div>
            ) : null}

            {skillPackages.length ? (
              <ul className="constraintList" style={{ marginTop: 10 }}>
                {skillPackages.slice(0, 20).map((pkg) => (
                  <li key={pkg.skill_package_id} className="constraintRow">
                    <div className="constraintTop">
                      <span className="mono">
                        {pkg.skill_id}@{pkg.version}
                      </span>
                      <span className={skillPackageStatusPill(pkg.verification_status)}>
                        {pkg.verification_status}
                      </span>
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      <span className="mono">{pkg.skill_package_id}</span>
                      <span className="muted"> · </span>
                      <span className="muted">{formatTimestamp(pkg.updated_at)}</span>
                      {pkg.quarantine_reason ? (
                        <>
                          <span className="muted"> · </span>
                          <span className="mono">{pkg.quarantine_reason}</span>
                        </>
                      ) : null}
                    </div>

                    <div className="decisionActions" style={{ marginTop: 10 }}>
                      {pkg.verification_status === "pending" ? (
                        <button
                          type="button"
                          className="primaryButton"
                          disabled={skillPackagesLoading || skillPackagesActionId === pkg.skill_package_id}
                          onClick={() => {
                            void (async () => {
                              setSkillPackagesActionId(pkg.skill_package_id);
                              setSkillPackagesActionError(null);
                              try {
                                await verifySkillPackage(pkg.skill_package_id);
                                await reloadSkillPackages();
                              } catch (e) {
                                setSkillPackagesActionError(toErrorCode(e));
                              } finally {
                                setSkillPackagesActionId(null);
                              }
                            })();
                          }}
                        >
                          {t("agent_profile.skill_packages.button.verify")}
                        </button>
                      ) : null}

                      {pkg.verification_status !== "quarantined" ? (
                        <button
                          type="button"
                          className="dangerButton"
                          disabled={
                            skillPackagesLoading ||
                            skillPackagesActionId === pkg.skill_package_id ||
                            !skillPackagesQuarantineReason.trim()
                          }
                          onClick={() => {
                            void (async () => {
                              const reason = skillPackagesQuarantineReason.trim();
                              if (!reason) return;
                              setSkillPackagesActionId(pkg.skill_package_id);
                              setSkillPackagesActionError(null);
                              try {
                                await quarantineSkillPackage(pkg.skill_package_id, reason);
                                await reloadSkillPackages();
                              } catch (e) {
                                setSkillPackagesActionError(toErrorCode(e));
                              } finally {
                                setSkillPackagesActionId(null);
                              }
                            })();
                          }}
                        >
                          {t("agent_profile.skill_packages.button.quarantine")}
                        </button>
                      ) : null}
                    </div>

                    <details className="advancedDetails">
                      <summary className="advancedSummary">{t("agent_profile.skill_packages.manifest")}</summary>
                      <JsonView value={{ manifest: pkg.manifest, hash_sha256: pkg.hash_sha256, signature: pkg.signature }} />
                    </details>
                  </li>
                ))}
              </ul>
            ) : null}

            {skillPackagesActionError ? (
              <div className="errorBox" style={{ marginTop: 10 }}>
                {t("error.load_failed", { code: skillPackagesActionError })}
              </div>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ packages: skillPackages }} />
            </details>
          </div>
        </div>
      ) : null}

      {activeTab === "growth" ? (
        <div className="agentProfileGrid">
          <div className="detailCard" style={{ gridColumn: "1 / -1" }}>
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.growth.kpi_title")}</div>
              <div className="muted">
                {latestSnapshot ? t("agent_profile.last_recalc", { at: formatTimestamp(latestSnapshot.updated_at) }) : ""}
              </div>
            </div>
            <div className="kpiGrid">
              <div className="kpiCard">
                <div className="kpiLabel">{t("agent_profile.trust_score")}</div>
                <div className="kpiValue mono">{trust ? trust.trust_score.toFixed(3) : "—"}</div>
                <div className="kpiSub">
                  <span className={statePillClass(trustTrend)}>{t(`agent_profile.growth.trend.${trustTrend}`)}</span>
                  <span className="mono">{trustDelta7d == null ? "—" : formatSigned(trustDelta7d)}</span>
                </div>
              </div>

              <div className="kpiCard">
                <div className="kpiLabel">{t("agent_profile.autonomy_rate_7d")}</div>
                <div className="kpiValue mono">{latestSnapshot ? formatPct01(latestSnapshot.autonomy_rate_7d) : "—"}</div>
                <div className="kpiSub">
                  <span className={statePillClass(autonomyTrend)}>{t(`agent_profile.growth.trend.${autonomyTrend}`)}</span>
                  <span className="mono">{autonomyDelta7d == null ? "—" : formatSignedPct01(autonomyDelta7d)}</span>
                </div>
              </div>

              <div className="kpiCard">
                <div className="kpiLabel">{t("agent_profile.growth.trust_growth_pct_7d")}</div>
                <div className="kpiValue mono">{trustGrowthPct == null ? "—" : formatSignedPercent(trustGrowthPct)}</div>
                <div className="kpiSub">
                  <span className={statePillClass(trustGrowthTrend)}>{t(`agent_profile.growth.trend.${trustGrowthTrend}`)}</span>
                </div>
              </div>

              <div className="kpiCard">
                <div className="kpiLabel">{t("agent_profile.growth.autonomy_growth_pct_7d")}</div>
                <div className="kpiValue mono">{autonomyGrowthPct == null ? "—" : formatSignedPercent(autonomyGrowthPct)}</div>
                <div className="kpiSub">
                  <span className={statePillClass(autonomyGrowthTrend)}>{t(`agent_profile.growth.trend.${autonomyGrowthTrend}`)}</span>
                </div>
              </div>

              <div className="kpiCard">
                <div className="kpiLabel">{t("agent_profile.new_skills_learned_7d")}</div>
                <div className="kpiValue mono">{latestSnapshot ? latestNewSkills7d : "—"}</div>
                <div className="kpiSub">
                  <span className={statePillClass(latestNewSkills7d > 0 ? "up" : "flat")}>
                    {latestNewSkills7d > 0
                      ? t("agent_profile.growth.kpi.skills_positive")
                      : t("agent_profile.growth.kpi.skills_none")}
                  </span>
                </div>
              </div>

              <div className="kpiCard">
                <div className="kpiLabel">{t("agent_profile.repeated_mistakes_7d")}</div>
                <div className="kpiValue mono">{latestSnapshot ? latestRepeatedMistakes7d : "—"}</div>
                <div className="kpiSub">
                  <span className={statePillClass(latestRepeatedMistakes7d > 0 ? "down" : "up")}>
                    {latestRepeatedMistakes7d > 0
                      ? t("agent_profile.growth.kpi.mistakes_present")
                      : t("agent_profile.growth.kpi.mistakes_clear")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.trust")}</div>
              <div className="muted">{trust ? t("agent_profile.last_recalc", { at: formatTimestamp(trust.last_recalculated_at) }) : ""}</div>
            </div>

            {trustError ? <div className="errorBox">{t("error.load_failed", { code: trustError })}</div> : null}
            {trustLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
            {!trustLoading && !trustError && !trust ? <div className="placeholder">{t("common.not_available")}</div> : null}

            {trust ? (
              <div className="kvGrid">
                <div className="kvKey">{t("agent_profile.trust_score")}</div>
                <div className="kvVal mono">{trust.trust_score.toFixed(3)}</div>

                <div className="kvKey">{t("agent_profile.success_rate_7d")}</div>
                <div className="kvVal mono">{formatPct01(trust.success_rate_7d)}</div>

                <div className="kvKey">{t("agent_profile.policy_violations_7d")}</div>
                <div className="kvVal mono">{trust.policy_violations_7d}</div>

                <div className="kvKey">{t("agent_profile.time_in_service_days")}</div>
                <div className="kvVal mono">{trust.time_in_service_days}</div>

                <div className="kvKey">{t("agent_profile.growth.delta_trust_7d")}</div>
                <div className="kvVal">
                  <span className="mono">{trustDelta7d == null ? "—" : formatSigned(trustDelta7d)}</span>
                  <span className={statePillClass(trustTrend)} style={{ marginLeft: 8 }}>
                    {t(`agent_profile.growth.trend.${trustTrend}`)}
                  </span>
                </div>

                <div className="kvKey">{t("agent_profile.growth.delta_autonomy_7d")}</div>
                <div className="kvVal">
                  <span className="mono">{autonomyDelta7d == null ? "—" : formatSignedPct01(autonomyDelta7d)}</span>
                  <span className={statePillClass(autonomyTrend)} style={{ marginLeft: 8 }}>
                    {t(`agent_profile.growth.trend.${autonomyTrend}`)}
                  </span>
                </div>

                <div className="kvKey">{t("agent_profile.growth.trust_growth_pct_7d")}</div>
                <div className="kvVal">
                  <span className="mono">{trustGrowthPct == null ? "—" : formatSignedPercent(trustGrowthPct)}</span>
                  <span className={statePillClass(trustGrowthTrend)} style={{ marginLeft: 8 }}>
                    {t(`agent_profile.growth.trend.${trustGrowthTrend}`)}
                  </span>
                </div>

                <div className="kvKey">{t("agent_profile.growth.autonomy_growth_pct_7d")}</div>
                <div className="kvVal">
                  <span className="mono">{autonomyGrowthPct == null ? "—" : formatSignedPercent(autonomyGrowthPct)}</span>
                  <span className={statePillClass(autonomyGrowthTrend)} style={{ marginLeft: 8 }}>
                    {t(`agent_profile.growth.trend.${autonomyGrowthTrend}`)}
                  </span>
                </div>
              </div>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ trust }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.snapshots")}</div>
            </div>

            {snapshotsError ? <div className="errorBox">{t("error.load_failed", { code: snapshotsError })}</div> : null}
            {snapshotsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}

            {!snapshotsLoading && !snapshotsError && snapshots.length === 0 ? (
              <div className="placeholder">{t("agent_profile.snapshots_empty")}</div>
            ) : null}

            {snapshots.length ? (
              <div className="tableWrap">
                <table className="dataTable">
                  <thead>
                    <tr>
                      <th>{t("agent_profile.snapshot.date")}</th>
                      <th>{t("agent_profile.trust_score")}</th>
                      <th>{t("agent_profile.autonomy_rate_7d")}</th>
                      <th>{t("agent_profile.new_skills_learned_7d")}</th>
                      <th>{t("agent_profile.constraints_learned_7d")}</th>
                      <th>{t("agent_profile.repeated_mistakes_7d")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshotRowsForTable.map((s) => (
                      <tr key={`${s.agent_id}:${s.snapshot_date}`}>
                        <td className="mono">{s.snapshot_date}</td>
                        <td className="mono">{s.trust_score.toFixed(3)}</td>
                        <td className="mono">{formatPct01(s.autonomy_rate_7d)}</td>
                        <td className="mono">{s.new_skills_learned_7d}</td>
                        <td className="mono">{s.constraints_learned_7d}</td>
                        <td className="mono">{s.repeated_mistakes_7d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ snapshots }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.skills")}</div>
            </div>

            {skillsError ? <div className="errorBox">{t("error.load_failed", { code: skillsError })}</div> : null}
            {skillsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
            {!skillsLoading && !skillsError && skills.length === 0 ? (
              <div className="placeholder">{t("agent_profile.skills_empty")}</div>
            ) : null}

            {primarySkill ? (
              <div className="skillPrimary">
                <div className="muted">{t("agent_profile.primary_skill")}</div>
                <div className="mono">{primarySkill.skill_id}</div>
                <div className="muted skillMeta">
                  <span className="mono">
                    {t("agent_profile.skill.learned_at")}:{" "}
                    {primarySkill.learned_at ? formatTimestamp(primarySkill.learned_at) : "-"}
                  </span>
                  <span className="mono">
                    {t("agent_profile.skill.last_used_at")}:{" "}
                    {primarySkill.last_used_at ? formatTimestamp(primarySkill.last_used_at) : "-"}
                  </span>
                </div>
              </div>
            ) : null}

            {topSkills.length ? (
              <ul className="skillList">
                {topSkills.map((s) => (
                  <li key={s.skill_id} className="skillRow">
                    <div className="skillTop">
                      <span className="mono">{s.skill_id}</span>
                      {s.is_primary ? <span className="statusPill statusApproved">{t("agent_profile.skill.primary")}</span> : null}
                    </div>
                    <div className="muted skillMeta">
                      <span className="mono">{t("agent_profile.skill.level")}: {s.level}</span>
                      <span className="mono">{t("agent_profile.skill.usage_7d")}: {s.usage_7d}</span>
                      <span className="mono">{t("agent_profile.skill.usage_30d")}: {s.usage_30d}</span>
                      <span className="mono">{t("agent_profile.skill.reliability")}: {s.reliability_score.toFixed(2)}</span>
                      <span className="mono">{t("agent_profile.skill.impact")}: {s.impact_score.toFixed(2)}</span>
                    </div>
                    <div className="muted skillMeta">
                      <span className="mono">
                        {t("agent_profile.skill.learned_at")}: {s.learned_at ? formatTimestamp(s.learned_at) : "-"}
                      </span>
                      <span className="mono">
                        {t("agent_profile.skill.last_used_at")}: {s.last_used_at ? formatTimestamp(s.last_used_at) : "-"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ skills }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.assessments")}</div>
              <div className="muted">
                {t("agent_profile.assessments.summary", {
                  passed: assessmentPassedCount,
                  failed: assessmentFailedCount,
                  regressions: assessmentRecentRegressions,
                })}
              </div>
            </div>

            {assessmentsError ? <div className="errorBox">{t("error.load_failed", { code: assessmentsError })}</div> : null}
            {assessmentsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
            {!assessmentsLoading && !assessmentsError && assessments.length === 0 ? (
              <div className="placeholder">{t("agent_profile.assessments_empty")}</div>
            ) : null}

            {recentAssessments.length ? (
              <>
                <div className="detailSectionTitle">{t("agent_profile.assessments_recent")}</div>
                <ul className="constraintList">
                  {recentAssessments.map((assessment) => (
                    <li key={assessment.assessment_id} className="constraintRow">
                      <div className="constraintTop">
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span className="mono">{assessment.skill_id}</span>
                          <span className={assessmentStatusPill(assessment.status)}>
                            {t(`agent_profile.assessment.status.${assessment.status}`)}
                          </span>
                          <span className="muted">{formatTimestamp(assessment.started_at)}</span>
                        </div>
                        {assessment.run_id ? (
                          <button
                            type="button"
                            className="ghostButton"
                            onClick={() => {
                              openInspectorByRun(assessment.run_id ?? "");
                            }}
                          >
                            {t("agent_profile.open_inspector.run")}
                          </button>
                        ) : null}
                      </div>
                      <div className="muted">
                        <span className="mono">
                          {t("agent_profile.assessment.score")}:{" "}
                          {typeof assessment.score === "number" ? assessment.score.toFixed(2) : "-"}
                        </span>
                        <span className="muted"> · </span>
                        <span className="mono">{t("agent_profile.assessment.run_id")}: {assessment.run_id ?? "-"}</span>
                        <span className="muted"> · </span>
                        <span className="mono">
                          {t("agent_profile.assessment.trigger_reason")}: {assessment.trigger_reason ?? "-"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ assessments }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.constraints")}</div>
              <div className="muted">
                {latestSnapshot
                  ? t("agent_profile.constraints_summary", {
                      learned: latestSnapshot.constraints_learned_7d,
                      mistakes: latestSnapshot.repeated_mistakes_7d,
                    })
                  : ""}
              </div>
            </div>

            {(constraintsError || mistakesError) ? (
              <div className="errorBox">{t("error.load_failed", { code: constraintsError ?? mistakesError ?? "unknown" })}</div>
            ) : null}
            {(constraintsLoading || mistakesLoading) ? <div className="placeholder">{t("common.loading")}</div> : null}

            {!constraintsLoading && !mistakesLoading && !constraintsError && !mistakesError && constraints.length === 0 && mistakes.length === 0 ? (
              <div className="placeholder">{t("agent_profile.constraints_empty")}</div>
            ) : null}

            {constraints.length ? (
              <>
                <div className="detailSectionTitle">{t("agent_profile.constraints_recent")}</div>
                <ul className="constraintList">
                  {constraints.slice(0, 6).map((c) => (
                    <li key={c.event_id} className="constraintRow">
                      <div className="constraintTop">
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span className="mono">{c.reason_code}</span>
                          <span className="muted">{formatTimestamp(c.occurred_at)}</span>
                        </div>
                        <button
                          type="button"
                          className="ghostButton"
                          onClick={() => {
                            openInspectorByEvent(c.event_id, c.run_id);
                          }}
                        >
                          {t("agent_profile.open_inspector.event")}
                        </button>
                      </div>
                      <div className="muted">
                        <span className="mono">{c.category}</span>
                        <span className="muted"> · </span>
                        <span className="mono">{c.action}</span>
                        <span className="muted"> · </span>
                        <span className="mono">{t("agent_profile.repeat_count")}: {c.repeat_count}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {mistakes.length ? (
              <>
                <div className="detailSectionTitle">{t("agent_profile.mistakes_recent")}</div>
                <ul className="constraintList">
                  {mistakes.slice(0, 6).map((m) => (
                    <li key={m.event_id} className="constraintRow">
                      <div className="constraintTop">
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span className="mono">{m.reason_code}</span>
                          <span className="muted">{formatTimestamp(m.occurred_at)}</span>
                        </div>
                        <button
                          type="button"
                          className="ghostButton"
                          onClick={() => {
                            openInspectorByEvent(m.event_id, m.run_id);
                          }}
                        >
                          {t("agent_profile.open_inspector.event")}
                        </button>
                      </div>
                      <div className="muted">
                        <span className="mono">{m.action}</span>
                        <span className="muted"> · </span>
                        <span className="mono">{t("agent_profile.repeat_count")}: {m.repeat_count}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ constraints, mistakes }} />
            </details>
          </div>

          <div className="detailCard" style={{ gridColumn: "1 / -1" }}>
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.change_timeline")}</div>
              <button
                type="button"
                className="ghostButton"
                onClick={() => {
                  void reloadChangeEvents();
                }}
                disabled={changeEventsLoading || !agentId.trim()}
              >
                {t("common.refresh")}
              </button>
            </div>

            {changeEventsError ? <div className="errorBox">{t("error.load_failed", { code: changeEventsError })}</div> : null}
            {changeEventsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
            {!changeEventsLoading && !changeEventsError && changeTimelineRows.length === 0 ? (
              <div className="placeholder">{t("agent_profile.change_timeline.empty")}</div>
            ) : null}

            {changeTimelineRows.length ? (
              <ul className="constraintList">
                {changeTimelineRows.map((event) => (
                  <li key={event.event_id} className="constraintRow">
                    <div className="constraintTop">
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="mono">
                          {t(`agent_profile.change_timeline.type.${event.event_type}`, {
                            defaultValue: event.event_type,
                          })}
                        </span>
                        <span className="muted">{formatTimestamp(event.occurred_at)}</span>
                      </div>
                      <button
                        type="button"
                        className="ghostButton"
                        onClick={() => {
                          openInspectorByEvent(event.event_id, event.run_id);
                        }}
                      >
                        {t("agent_profile.open_inspector.event")}
                      </button>
                    </div>
                    <div className="muted">
                      <span className="mono">
                        {t("agent_profile.change_timeline.actor")}: {event.actor_type}/{event.actor_id}
                      </span>
                      <span className="muted"> · </span>
                      <span className="mono">
                        {t("agent_profile.change_timeline.zone")}: {event.zone}
                      </span>
                      <span className="muted"> · </span>
                      <span className="mono">
                        {t("agent_profile.change_timeline.summary")}: {event.summary}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ change_events: relevantChangeEvents }} />
            </details>
          </div>
        </div>
      ) : null}
    </section>
  );
}
