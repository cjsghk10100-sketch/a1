export interface SecretDlpMatch {
  rule_id: string;
  match_preview: string;
}

export interface SecretDlpScanResult {
  contains_secrets: boolean;
  matches: SecretDlpMatch[];
  scanned_bytes: number;
}

export interface SecretDlpRedactionResult {
  redacted: unknown;
  changed: boolean;
  redacted_values: number;
}

interface DlpRule {
  rule_id: string;
  regex: RegExp;
}

const DLP_RULES: readonly DlpRule[] = [
  { rule_id: "openai_api_key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { rule_id: "github_pat", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { rule_id: "aws_access_key_id", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule_id: "bearer_token", regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/g },
];

const MAX_SCAN_BYTES = 256_000;
const MAX_MATCHES = 20;
const MAX_REDACTION_DEPTH = 20;
const REDACTED_VALUE = "[redacted]";

function maskSecret(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function stringifyForScan(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return String(input ?? "");
  }
}

export function scanForSecrets(input: unknown): SecretDlpScanResult {
  const fullText = stringifyForScan(input);
  const text = fullText.length > MAX_SCAN_BYTES ? fullText.slice(0, MAX_SCAN_BYTES) : fullText;

  const seen = new Set<string>();
  const matches: SecretDlpMatch[] = [];

  for (const rule of DLP_RULES) {
    rule.regex.lastIndex = 0;

    while (matches.length < MAX_MATCHES) {
      const m = rule.regex.exec(text);
      if (!m) break;

      const rawMatch = m[0] ?? "";
      if (!rawMatch) {
        if (rule.regex.lastIndex <= m.index) {
          rule.regex.lastIndex = m.index + 1;
        }
        continue;
      }

      const dedupeKey = `${rule.rule_id}:${rawMatch}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        matches.push({
          rule_id: rule.rule_id,
          match_preview: maskSecret(rawMatch),
        });
      }
    }
  }

  return {
    contains_secrets: matches.length > 0,
    matches,
    scanned_bytes: text.length,
  };
}

function redactStringWithRules(input: string): { value: string; changed: boolean } {
  let value = input;
  let changed = false;

  for (const rule of DLP_RULES) {
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    const next = value.replace(re, REDACTED_VALUE);
    if (next !== value) {
      changed = true;
      value = next;
    }
  }

  return { value, changed };
}

function redactUnknownInner(
  input: unknown,
  depth: number,
): { value: unknown; changed: boolean; redacted_values: number } {
  if (depth > MAX_REDACTION_DEPTH) {
    return { value: REDACTED_VALUE, changed: true, redacted_values: 1 };
  }
  if (input == null) return { value: input, changed: false, redacted_values: 0 };

  if (typeof input === "string") {
    const redacted = redactStringWithRules(input);
    return {
      value: redacted.value,
      changed: redacted.changed,
      redacted_values: redacted.changed ? 1 : 0,
    };
  }

  if (typeof input === "number" || typeof input === "boolean") {
    return { value: input, changed: false, redacted_values: 0 };
  }

  if (Array.isArray(input)) {
    const out: unknown[] = [];
    let changed = false;
    let redacted_values = 0;
    for (const item of input) {
      const next = redactUnknownInner(item, depth + 1);
      out.push(next.value);
      if (next.changed) changed = true;
      redacted_values += next.redacted_values;
    }
    return { value: out, changed, redacted_values };
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    let changed = false;
    let redacted_values = 0;
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const next = redactUnknownInner(v, depth + 1);
      out[k] = next.value;
      if (next.changed) changed = true;
      redacted_values += next.redacted_values;
    }
    return { value: out, changed, redacted_values };
  }

  return { value: String(input), changed: true, redacted_values: 1 };
}

export function redactSecrets(input: unknown): SecretDlpRedactionResult {
  const redacted = redactUnknownInner(input, 0);
  return {
    redacted: redacted.value,
    changed: redacted.changed,
    redacted_values: redacted.redacted_values,
  };
}
