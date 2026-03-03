import type { ReactNode } from "react";

import { StatusBadge } from "../shared/StatusBadge";

export function PanelCard({
  title,
  status,
  action,
  children,
}: {
  title: string;
  status?: "OK" | "DEGRADED" | "DOWN" | null;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-700">{title}</div>
          {status !== undefined ? <StatusBadge status={status} /> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
