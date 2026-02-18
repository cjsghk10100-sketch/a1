export type PinKind = "thread" | "message";

export interface PinItemV1 {
  kind: PinKind;
  entity_id: string;
  room_id: string;
  thread_id: string;
  label: string;
  created_at: string;
}

export const pinsStorageKey = "agentapp.pins.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeKind(value: string | null): PinKind | null {
  if (value === "thread") return "thread";
  if (value === "message") return "message";
  return null;
}

export function loadPins(): PinItemV1[] {
  const raw = localStorage.getItem(pinsStorageKey);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const out: PinItemV1[] = [];
    for (const item of parsed) {
      if (!isRecord(item)) continue;

      const kind = normalizeKind(asString(item.kind));
      const entity_id = asString(item.entity_id);
      const room_id = asString(item.room_id);
      const thread_id = asString(item.thread_id);
      const label = asString(item.label);
      const created_at = asString(item.created_at);

      if (!kind || !entity_id || !room_id || !thread_id || !label || !created_at) continue;
      out.push({ kind, entity_id, room_id, thread_id, label, created_at });
    }
    return out;
  } catch {
    return [];
  }
}

export function savePins(pins: PinItemV1[]): void {
  localStorage.setItem(pinsStorageKey, JSON.stringify(pins));
}

export function pinKey(kind: PinKind, entityId: string): string {
  return `${kind}:${entityId}`;
}

export function togglePin(pins: PinItemV1[], next: PinItemV1): PinItemV1[] {
  const key = pinKey(next.kind, next.entity_id);
  const filtered = pins.filter((p) => pinKey(p.kind, p.entity_id) !== key);
  if (filtered.length !== pins.length) return filtered;

  // Newest-first; keep list bounded.
  return [next, ...pins].slice(0, 200);
}

