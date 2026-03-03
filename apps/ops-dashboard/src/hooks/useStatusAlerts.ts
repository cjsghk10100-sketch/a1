import { useEffect, useRef, useState } from "react";

import { translate } from "../i18n/messages";

export type HealthStatus = "OK" | "DEGRADED" | "DOWN" | null;

export type StatusTransition = {
  status: Exclude<HealthStatus, null>;
  timestamp: string;
  reasons: string[];
};

const MAX_HISTORY = 50;

export function useStatusAlerts(status: HealthStatus, reasons: string[]) {
  const prevRef = useRef<HealthStatus>(null);
  const [history, setHistory] = useState<StatusTransition[]>([]);

  useEffect(() => {
    const base = translate("statusAlerts.baseTitle");
    if (status === "DOWN") {
      document.title = translate("statusAlerts.title.down", { base });
    } else if (status === "DEGRADED") {
      document.title = translate("statusAlerts.title.degraded", { base });
    } else {
      document.title = base;
    }

    const prev = prevRef.current;
    prevRef.current = status;

    if (!status || !prev || prev === status) {
      return;
    }

    const entry = {
      status,
      timestamp: new Date().toISOString(),
      reasons,
    };

    setHistory((current) => [entry, ...current].slice(0, MAX_HISTORY));

    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const note = new Notification(translate("statusAlerts.notify.title", { status }), {
        body:
          reasons.length > 0
            ? translate("statusAlerts.notify.body.reasons", { value: reasons.join(", ") })
            : translate("statusAlerts.notify.body.empty"),
      });
      note.onclick = () => window.focus();
    }
  }, [status, reasons]);

  const requestPermission = async (): Promise<NotificationPermission | "unsupported"> => {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "granted") return "granted";
    return Notification.requestPermission();
  };

  return {
    history,
    requestPermission,
  };
}
