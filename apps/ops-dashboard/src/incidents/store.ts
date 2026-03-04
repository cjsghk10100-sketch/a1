import type { TopIssue } from "../api/types";
import type { DashboardIncident, DashboardSlaSnapshot } from "../config/DashboardContext";

const REOPEN_WINDOW_MS = 5 * 60 * 1000;
const MAX_SLA_SNAPSHOTS = 200;

function parseTs(value: string | null): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function buildIncidentId(kind: string): string {
  return `inc_${kind}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function tickIncidentSla(incidents: DashboardIncident[], elapsedSec: number): DashboardIncident[] {
  if (elapsedSec <= 0) return incidents;
  return incidents.map((incident) => {
    if (incident.status === "resolved") return incident;
    return {
      ...incident,
      slaViolationSec: incident.slaViolationSec + elapsedSec,
    };
  });
}

export function syncTopIssues(
  incidents: DashboardIncident[],
  topIssues: TopIssue[],
  nowIso: string,
): DashboardIncident[] {
  const next = [...incidents];
  const activeKinds = new Set<string>(topIssues.map((issue) => issue.kind));

  for (const issue of topIssues) {
    const active = next.find((incident) => incident.kind === issue.kind && incident.status !== "resolved");
    if (active) {
      active.severity = issue.severity;
      active.lastSeenAt = nowIso;
      active.entityId = issue.entity_id ?? active.entityId;
      continue;
    }

    const resolved = next
      .filter((incident) => incident.kind === issue.kind && incident.status === "resolved")
      .sort((a, b) => parseTs(b.resolvedAt) - parseTs(a.resolvedAt))[0];
    const nowMs = parseTs(nowIso);
    if (resolved && nowMs - parseTs(resolved.resolvedAt) <= REOPEN_WINDOW_MS) {
      resolved.status = "open";
      resolved.severity = issue.severity;
      resolved.resolvedAt = null;
      resolved.lastSeenAt = nowIso;
      resolved.reopenCount += 1;
      resolved.entityId = issue.entity_id ?? resolved.entityId;
      continue;
    }

    next.push({
      id: buildIncidentId(issue.kind),
      kind: issue.kind,
      severity: issue.severity,
      status: "open",
      openedAt: nowIso,
      acknowledgedAt: null,
      resolvedAt: null,
      lastSeenAt: nowIso,
      reopenCount: 0,
      slaViolationSec: 0,
      entityId: issue.entity_id ?? null,
    });
  }

  for (const incident of next) {
    if (incident.status === "resolved") continue;
    if (!activeKinds.has(incident.kind)) {
      incident.status = "resolved";
      incident.resolvedAt = nowIso;
      incident.lastSeenAt = nowIso;
    }
  }

  return next.sort((a, b) => parseTs(b.openedAt) - parseTs(a.openedAt));
}

export function activeIncidentCount(incidents: DashboardIncident[]): number {
  return incidents.filter((incident) => incident.status !== "resolved").length;
}

export function totalViolationSec(incidents: DashboardIncident[]): number {
  return incidents.reduce((sum, incident) => {
    if (incident.status === "resolved") return sum;
    return sum + incident.slaViolationSec;
  }, 0);
}

export function appendSlaSnapshot(
  snapshots: DashboardSlaSnapshot[],
  snapshot: DashboardSlaSnapshot,
): DashboardSlaSnapshot[] {
  const next = [...snapshots, snapshot];
  if (next.length <= MAX_SLA_SNAPSHOTS) return next;
  return next.slice(next.length - MAX_SLA_SNAPSHOTS);
}

export type IncidentTimelineEvent = {
  id: string;
  incidentId: string;
  kind: string;
  severity: "DOWN" | "DEGRADED";
  status: DashboardIncident["status"];
  at: string;
  label: "opened" | "acknowledged" | "resolved";
};

export function buildTimelineEvents(incidents: DashboardIncident[]): IncidentTimelineEvent[] {
  const events: IncidentTimelineEvent[] = [];
  for (const incident of incidents) {
    events.push({
      id: `${incident.id}:opened`,
      incidentId: incident.id,
      kind: incident.kind,
      severity: incident.severity,
      status: incident.status,
      at: incident.openedAt,
      label: "opened",
    });
    if (incident.acknowledgedAt) {
      events.push({
        id: `${incident.id}:ack`,
        incidentId: incident.id,
        kind: incident.kind,
        severity: incident.severity,
        status: incident.status,
        at: incident.acknowledgedAt,
        label: "acknowledged",
      });
    }
    if (incident.resolvedAt) {
      events.push({
        id: `${incident.id}:resolved`,
        incidentId: incident.id,
        kind: incident.kind,
        severity: incident.severity,
        status: incident.status,
        at: incident.resolvedAt,
        label: "resolved",
      });
    }
  }
  return events.sort((a, b) => parseTs(b.at) - parseTs(a.at));
}
