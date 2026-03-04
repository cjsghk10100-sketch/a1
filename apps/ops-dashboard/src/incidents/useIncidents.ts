import { useMemo } from "react";

import { useDashboardContext } from "../config/DashboardContext";
import { buildTimelineEvents } from "./store";

export function useIncidents() {
  const { incidents } = useDashboardContext();
  const timeline = useMemo(() => buildTimelineEvents(incidents), [incidents]);
  return {
    incidents,
    timeline,
  };
}
