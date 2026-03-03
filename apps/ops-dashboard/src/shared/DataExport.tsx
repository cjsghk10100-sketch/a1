import { useMemo } from "react";

import { useI18n } from "../i18n/useI18n";

type JsonRecord = Record<string, unknown>;

const REDACTED = "[REDACTED]";

const SECRET_KEY_PATTERNS = [
  /token/i,
  /authorization/i,
  /bearer/i,
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /passphrase/i,
  /private[_-]?key/i,
  /cookie/i,
  /session/i,
  /credential/i,
];

const PII_KEY_PATTERNS = [
  /(^|[_-])(email|phone|mobile|address|ip|ssn|resident|passport)([_-]|$)/i,
  /(^|[_-])(first_name|last_name|full_name|display_name|user_name|username)([_-]|$)/i,
];

function isSensitiveKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isPiiValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;
  if (/^\+?[0-9][0-9\s().-]{6,}$/.test(trimmed)) return true;
  return false;
}

function sanitize(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      const lower = key.toLowerCase();
      if (isSensitiveKey(lower) || isPiiKey(lower)) {
        continue;
      }
      out[key] = sanitize(child, lower);
    }
    return out;
  }
  if (isSensitiveKey(parentKey) || isPiiKey(parentKey) || isPiiValue(value)) {
    return REDACTED;
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
  const { t } = useI18n();
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
        {t("export.copyJson")}
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
        {t("export.downloadJson")}
      </button>
    </div>
  );
}
