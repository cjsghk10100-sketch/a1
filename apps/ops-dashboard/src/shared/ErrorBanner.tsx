import type { ApiErrorInfo } from "../api/types";
import { formatRelativeTime } from "../utils/format";

function categoryMessage(error: ApiErrorInfo): string {
  if (error.category === "auth") {
    return "Authentication failed (401/403). Token may be expired. Update config.json and reload.";
  }
  if (error.category === "network") {
    return "Cannot reach API server. Check network connection.";
  }
  if (error.category === "server") {
    return "API returned server error. Will retry automatically.";
  }
  if (error.category === "timeout") {
    return "Request timed out after 15s. Will retry.";
  }
  return "API rejected request. Check dashboard version/contract.";
}

export function ErrorBanner({
  error,
  stale,
  lastUpdatedAt,
}: {
  error: ApiErrorInfo;
  stale?: boolean;
  lastUpdatedAt?: Date | null;
}): JSX.Element {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div>{categoryMessage(error)}</div>
      {stale && lastUpdatedAt ? <div>Showing data from {formatRelativeTime(lastUpdatedAt.toISOString())}</div> : null}
    </div>
  );
}
