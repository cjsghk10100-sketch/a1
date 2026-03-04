import { useCallback, useMemo, useState } from "react";

import type { HealthResponse } from "../api/types";
import type { DashboardIncident, DashboardSlaSnapshot } from "../config/DashboardContext";

const MAX_SNAPSHOTS = 200;

function activeCount(incidents: DashboardIncident[]): number {
  return incidents.filter((incident) => incident.status !== "resolved").length;
}

function activeSlaSec(incidents: DashboardIncident[]): number {
  return incidents.reduce((sum, incident) => {
    if (incident.status === "resolved") return sum;
    return sum + incident.slaViolationSec;
  }, 0);
}

export function useSLASnapshots(incidents: DashboardIncident[]) {
  const [snapshots, setSnapshots] = useState<DashboardSlaSnapshot[]>([]);

  const record = useCallback((health: HealthResponse) => {
    const at = health.server_time ?? new Date().toISOString();
    const status = health.summary?.status ?? health.summary?.health_summary ?? "OK";
    setSnapshots((current) => {
      const next = [
        ...current,
        {
          at,
          totalViolationSec: activeSlaSec(incidents),
          openCount: activeCount(incidents),
          systemStatus: status,
        },
      ];
      if (next.length <= MAX_SNAPSHOTS) return next;
      return next.slice(next.length - MAX_SNAPSHOTS);
    });
  }, [incidents]);

  const latest = useMemo(() => snapshots[snapshots.length - 1] ?? null, [snapshots]);

  return {
    snapshots,
    latest,
    record,
  };
}
