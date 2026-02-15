import type { ApprovalStatus } from "../api/approvals";

function cls(status: ApprovalStatus): string {
  if (status === "pending") return "statusPill statusPending";
  if (status === "held") return "statusPill statusHeld";
  if (status === "approved") return "statusPill statusApproved";
  return "statusPill statusDenied";
}

export function StatusPill(props: { status: ApprovalStatus; label: string }): JSX.Element {
  return <span className={cls(props.status)}>{props.label}</span>;
}

