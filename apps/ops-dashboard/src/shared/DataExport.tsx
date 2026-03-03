import { useMemo } from "react";

type JsonRecord = Record<string, unknown>;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      const lower = key.toLowerCase();
      if (lower.includes("token") || lower.includes("authorization") || lower.includes("bearer")) {
        continue;
      }
      out[key] = sanitize(child);
    }
    return out;
  }
  return value;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataExport({
  panelId,
  workspaceId,
  data,
}: {
  panelId: string;
  workspaceId: string;
  data: unknown;
}): JSX.Element {
  const payload = useMemo(
    () =>
      sanitize({
        panelId,
        workspace_id: workspaceId,
        exported_at: new Date().toISOString(),
        data,
      }),
    [panelId, workspaceId, data],
  );

  const asJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  return (
    <div className="flex gap-1">
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs"
        onClick={() => {
          void navigator.clipboard?.writeText(asJson);
        }}
      >
        Copy JSON
      </button>
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs"
        onClick={() => {
          const now = new Date();
          const ts = [
            now.getUTCFullYear(),
            String(now.getUTCMonth() + 1).padStart(2, "0"),
            String(now.getUTCDate()).padStart(2, "0"),
          ].join("-")
            .concat("_")
            .concat([String(now.getUTCHours()).padStart(2, "0"), String(now.getUTCMinutes()).padStart(2, "0")].join("-"));
          downloadText(`${panelId}_${ts}.json`, asJson);
        }}
      >
        Download JSON
      </button>
    </div>
  );
}
