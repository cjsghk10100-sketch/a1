import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentRecordV1 } from "@agentapp/shared";

import type {
  AgentSkillRow,
  AgentTrustRow,
  CapabilityTokenRow,
  ConstraintLearnedRow,
  DailyAgentSnapshotRow,
  MistakeRepeatedRow,
  RegisteredAgent,
} from "../api/agents";
import {
  getAgent,
  getAgentTrust,
  listAgentSkills,
  listAgentSnapshots,
  listCapabilityTokens,
  listConstraintLearnedEvents,
  listMistakeRepeatedEvents,
  listRegisteredAgents,
  quarantineAgent,
  unquarantineAgent,
} from "../api/agents";
import { ApiError } from "../api/http";
import { JsonView } from "../components/JsonView";

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

function isTokenActive(token: CapabilityTokenRow): boolean {
  if (token.revoked_at) return false;
  if (token.valid_until) {
    const t = new Date(token.valid_until).getTime();
    if (Number.isFinite(t) && t <= Date.now()) return false;
  }
  return true;
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

export function AgentProfilePage(): JSX.Element {
  const { t } = useTranslation();

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

  const [agentId, setAgentId] = useState<string>(() => localStorage.getItem(agentStorageKey) ?? "");
  const [manualAgentId, setManualAgentId] = useState<string>("");

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

  const [snapshots, setSnapshots] = useState<DailyAgentSnapshotRow[]>([]);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState<boolean>(false);

  const [constraints, setConstraints] = useState<ConstraintLearnedRow[]>([]);
  const [constraintsError, setConstraintsError] = useState<string | null>(null);
  const [constraintsLoading, setConstraintsLoading] = useState<boolean>(false);

  const [mistakes, setMistakes] = useState<MistakeRepeatedRow[]>([]);
  const [mistakesError, setMistakesError] = useState<string | null>(null);
  const [mistakesLoading, setMistakesLoading] = useState<boolean>(false);

  const activeTokens = useMemo(() => tokens.filter((tok) => isTokenActive(tok)), [tokens]);
  const scopeUnion = useMemo(() => unionScopes(tokens), [tokens]);

  const primarySkill = useMemo(() => skills.find((s) => s.is_primary) ?? null, [skills]);
  const topSkills = useMemo(() => skills.slice(0, 6), [skills]);
  const latestSnapshot = useMemo(() => (snapshots.length ? snapshots[0] : null), [snapshots]);
  const snapshotRowsForTable = useMemo(() => snapshots.slice(0, 14), [snapshots]);

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

    setTrust(null);
    setTokens([]);
    setSkills([]);
    setSnapshots([]);
    setConstraints([]);
    setMistakes([]);

    setTrustError(null);
    setTokensError(null);
    setSkillsError(null);
    setSnapshotsError(null);
    setConstraintsError(null);
    setMistakesError(null);

    if (!agentId.trim()) {
      setAgentMetaLoading(false);
      setTrustLoading(false);
      setSkillsLoading(false);
      setSnapshotsLoading(false);
      setConstraintsLoading(false);
      setMistakesLoading(false);
      setTokensLoading(false);
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
    setSnapshotsLoading(true);
    setConstraintsLoading(true);
    setMistakesLoading(true);

    void (async () => {
      try {
        const [trustRes, skillsRes, snapshotsRes, constraintsRes, mistakesRes] = await Promise.all([
          getAgentTrust(agentId),
          listAgentSkills({ agent_id: agentId, limit: 50 }),
          listAgentSnapshots({ agent_id: agentId, days: 30 }),
          listConstraintLearnedEvents({ agent_id: agentId, limit: 200 }),
          listMistakeRepeatedEvents({ agent_id: agentId, limit: 200 }),
        ]);

        if (cancelled) return;
        setTrust(trustRes);
        setSkills(skillsRes);
        setSnapshots(snapshotsRes);
        setConstraints(constraintsRes);
        setMistakes(mistakesRes);
      } catch (e) {
        if (cancelled) return;
        const code = toErrorCode(e);
        // We load these in parallel; if any fails, show the code in each section.
        setTrustError(code);
        setSkillsError(code);
        setSnapshotsError(code);
        setConstraintsError(code);
        setMistakesError(code);
      } finally {
        if (cancelled) return;
        setTrustLoading(false);
        setSkillsLoading(false);
        setSnapshotsLoading(false);
        setConstraintsLoading(false);
        setMistakesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

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

  const agentOptions = useMemo(() => {
    return agents.map((a) => ({
      value: a.agent_id,
      label: `${a.display_name} (${a.agent_id})`,
    }));
  }, [agents]);

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
          {agentsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
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

            <details className="advancedDetails">
              <summary className="advancedSummary">{t("common.advanced")}</summary>
              <JsonView value={{ tokens }} />
            </details>
          </div>

          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{t("agent_profile.section.delegation")}</div>
            </div>

            {!tokens.length ? <div className="placeholder">{t("agent_profile.tokens_empty")}</div> : null}

            {tokens.length ? (
              <ul className="agentChainList">
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
            ) : null}
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
        </div>
      ) : null}

      {activeTab === "growth" ? (
        <div className="agentProfileGrid">
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
                      <span className="mono">{t("agent_profile.skill.reliability")}: {s.reliability_score.toFixed(2)}</span>
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
                        <span className="mono">{c.reason_code}</span>
                        <span className="muted">{formatTimestamp(c.occurred_at)}</span>
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
                        <span className="mono">{m.reason_code}</span>
                        <span className="muted">{formatTimestamp(m.occurred_at)}</span>
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
        </div>
      ) : null}
    </section>
  );
}
