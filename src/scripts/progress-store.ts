export const STORAGE_KEY = 'trainer_completed_v1';
export const TOTAL_DAYS = 84;
export const DAYS_PER_WEEK = 7;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{15}$/;

/**
 * Normalize an arbitrary list of day numbers into sorted unique integers 1..84.
 */
export function normalizeDays(days: Iterable<unknown>): number[] {
  const unique = new Set<number>();
  for (const item of days) {
    if (typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= TOTAL_DAYS) {
      unique.add(item);
    }
  }
  return Array.from(unique).sort((a, b) => a - b);
}

/**
 * Encode completed days (1..84) into an exact 11-byte (88-bit) 15-char Base64URL token.
 */
export function encodeProgressToken(days: Iterable<number>): string {
  const bytes = new Uint8Array(11);
  for (const day of normalizeDays(days)) {
    const idx = day - 1;
    bytes[Math.floor(idx / 8)] |= 1 << (idx % 8);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a 15-char Base64URL token back into sorted completed day numbers (1..84),
 * or return null when malformed.
 */
export function decodeProgressToken(token: string | null | undefined): number[] | null {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return null;
  }
  try {
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/') + '=';
    const binary = atob(base64);
    if (binary.length !== 11) {
      return null;
    }
    // Reject non-zero unused top bits (bits 84..87) so invalid trailing encodings don't alias.
    if ((binary.charCodeAt(10) & 0xf0) !== 0) {
      return null;
    }
    const out: number[] = [];
    for (let day = 1; day <= TOTAL_DAYS; day++) {
      const idx = day - 1;
      const byteVal = binary.charCodeAt(Math.floor(idx / 8));
      if ((byteVal & (1 << (idx % 8))) !== 0) {
        out.push(day);
      }
    }
    // Verify canonical 2 padding bits in the 15th Base64URL character were zeroed.
    if (encodeProgressToken(out) !== token) {
      return null;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Resolve the next suggested training day:
 * - 1 when empty
 * - First incomplete day strictly after max(completed)
 * - Wraps to lowest incomplete 1..84 if max === 84
 * - null when all 84 days are complete
 */
export function computeNextDay(days: Iterable<number>): number | null {
  const normalized = normalizeDays(days);
  if (normalized.length === 0) {
    return 1;
  }
  if (normalized.length >= TOTAL_DAYS) {
    return null;
  }
  const done = new Set(normalized);
  const maxDay = normalized[normalized.length - 1]!;
  for (let d = maxDay + 1; d <= TOTAL_DAYS; d++) {
    if (!done.has(d)) {
      return d;
    }
  }
  for (let d = 1; d < maxDay; d++) {
    if (!done.has(d)) {
      return d;
    }
  }
  return null;
}

export function countWeekCompleted(days: Iterable<number>, weekNumber: number): number {
  const start = (weekNumber - 1) * DAYS_PER_WEEK + 1;
  const end = weekNumber * DAYS_PER_WEEK;
  let count = 0;
  for (const d of normalizeDays(days)) {
    if (d >= start && d <= end) {
      count++;
    }
  }
  return count;
}

export function toggleDayInList(days: Iterable<number>, dayNumber: number): number[] {
  const done = new Set(normalizeDays(days));
  if (Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= TOTAL_DAYS) {
    if (done.has(dayNumber)) {
      done.delete(dayNumber);
    } else {
      done.add(dayNumber);
    }
  }
  return Array.from(done).sort((a, b) => a - b);
}

export function readCompletedDays(storage: Pick<Storage, 'getItem'> | null | undefined): number[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeDays(parsed);
  } catch {
    return [];
  }
}

export function writeCompletedDays(
  days: Iterable<number>,
  storage: Pick<Storage, 'setItem'> | null | undefined,
): number[] {
  const normalized = normalizeDays(days);
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota or private-browsing exceptions cleanly.
    }
  }
  return normalized;
}

export function clearCompletedDays(
  storage: Pick<Storage, 'removeItem'> | null | undefined,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage exceptions cleanly.
  }
}

export function buildBackupUrl(currentHref: string, days: Iterable<number>): string {
  const url = new URL(currentHref);
  url.searchParams.set('p', encodeProgressToken(days));
  return url.toString();
}
