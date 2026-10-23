import { COMMERCIAL_KEYS, PRICING_KEYS } from '@pintoria/shared';

const RESTRICTED_KEYS = new Set([...PRICING_KEYS, ...COMMERCIAL_KEYS]);

export function isRestrictedKey(key: string): boolean {
  return RESTRICTED_KEYS.has(key);
}

/**
 * Deep-strips pricing and commercial fields (structural clone; original untouched).
 * Used for every surface a user without `pricing.view` can receive:
 * API responses, audit/status payloads, notification payloads, exports, file metadata.
 */
export function stripRestricted<T>(value: T): T {
  return strip(value, new Set()) as T;
}

function strip(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((v) => strip(v, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isRestrictedKey(k)) continue;
    out[k] = strip(v, seen);
  }
  return out;
}

/** Convenience for list payloads: strips each row, keeps order. */
export function stripRestrictedRows<T>(rows: T[]): T[] {
  return rows.map((r) => stripRestricted(r));
}
