type JsonRecord = Record<string, unknown>;

export const REDACTED = "[REDACTED]";

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

function normalizeTokenSource(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const noBearer = /^bearer\s+/i.test(trimmed) ? trimmed.replace(/^bearer\s+/i, "") : trimmed;
  return noBearer.replace(/^['"]+|['"]+$/g, "");
}

export function maskToken(value: string): string {
  const normalized = normalizeTokenSource(value);
  if (!normalized) return REDACTED;
  if (normalized.length <= 6) return `${normalized.slice(0, 1)}***${normalized.slice(-1)}`;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

export function redactSecretText(text: string): string {
  if (!text) return text;

  let output = text;
  output = output.replace(/(bearer\s+)([^\s,;]+)/gi, (_full, prefix: string, token: string) => {
    return `${prefix}${maskToken(token)}`;
  });
  output = output.replace(
    /((?:^|[\s,;])(?:x-engine-token|engine_token|engine-auth-token|auth_token|token|secret|password|passphrase|api[_-]?key|cookie|session|credential)\s*[:=]\s*)([^\s,;]+)/gi,
    (_full, prefix: string, token: string) => {
      return `${prefix}${maskToken(token)}`;
    },
  );

  return output;
}

function redactValue(
  value: unknown,
  parentKey: string,
  options: { removeSensitiveKeys: boolean },
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, parentKey, options));
  }

  if (value && typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      const lower = key.toLowerCase();
      if (isSensitiveKey(lower) || isPiiKey(lower)) {
        if (!options.removeSensitiveKeys) out[key] = REDACTED;
        continue;
      }
      out[key] = redactValue(child, lower, options);
    }
    return out;
  }

  if (isSensitiveKey(parentKey) || isPiiKey(parentKey) || isPiiValue(value)) {
    return REDACTED;
  }

  if (typeof value === "string") {
    return redactSecretText(value);
  }
  return value;
}

export function redactSecrets(
  value: unknown,
  options?: { removeSensitiveKeys?: boolean },
): unknown {
  return redactValue(value, "", { removeSensitiveKeys: options?.removeSensitiveKeys ?? false });
}
