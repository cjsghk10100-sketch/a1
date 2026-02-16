export interface SecretDlpMatch {
  rule_id: string;
  match_preview: string;
}

export interface SecretDlpScanResult {
  contains_secrets: boolean;
  matches: SecretDlpMatch[];
  scanned_bytes: number;
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
