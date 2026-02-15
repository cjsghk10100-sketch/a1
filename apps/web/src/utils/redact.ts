const DEFAULT_KEY_PATTERNS: RegExp[] = [
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /password/i,
  /secret/i,
  /session/i,
  /token/i,
];

function looksLikeSecretValue(value: string): boolean {
  const v = value.trim();
  if (v.length < 24) return false;
  if (/\s/.test(v)) return false;
  if (/^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(v)) return true; // JWT
  if (/^sk-[a-zA-Z0-9]{20,}$/.test(v)) return true;
  if (/^[A-Za-z0-9_-]{32,}$/.test(v)) return true;
  return false;
}

export function redactUnknown(input: unknown): unknown {
  return redactUnknownInner(input, 0);
}

function redactUnknownInner(input: unknown, depth: number): unknown {
  if (depth > 20) return "[redacted]";
  if (input == null) return input;

  if (typeof input === "string") {
    return looksLikeSecretValue(input) ? "[redacted]" : input;
  }

  if (typeof input === "number" || typeof input === "boolean") return input;

  if (Array.isArray(input)) {
    return input.map((v) => redactUnknownInner(v, depth + 1));
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (DEFAULT_KEY_PATTERNS.some((re) => re.test(k))) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactUnknownInner(v, depth + 1);
      }
    }
    return out;
  }

  return String(input);
}

