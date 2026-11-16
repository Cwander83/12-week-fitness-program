import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  buildBackupUrl,
  clearCompletedDays,
  computeNextDay,
  countWeekCompleted,
  decodeProgressToken,
  encodeProgressToken,
  normalizeDays,
  readCompletedDays,
  toggleDayInList,
  writeCompletedDays,
} from '../src/scripts/progress-store';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('progress-store', () => {
  it('encodes and decodes empty, sparse, contiguous, and full 84-day bitfields to 15-char Base64URL tokens', () => {
    const cases: number[][] = [
      [],
      [1],
      [84],
      [1, 8, 54, 80, 84],
      Array.from({ length: 53 }, (_, i) => i + 1),
      Array.from({ length: 84 }, (_, i) => i + 1),
    ];

    for (const days of cases) {
      const token = encodeProgressToken(days);
      expect(token).toMatch(/^[A-Za-z0-9_-]{15}$/);
      expect(decodeProgressToken(token)).toEqual(days);
    }
  });

  it('normalizes unsorted, duplicate, and out-of-range days before encoding', () => {
    const token = encodeProgressToken([54, 1, 54, 0, -3, 85, 12.5, 8]);
    expect(decodeProgressToken(token)).toEqual([1, 8, 54]);
    expect(normalizeDays([84, 2, 2, 0, 99, 1])).toEqual([1, 2, 84]);
  });

  it('rejects malformed, wrong-length, and non-canonical tokens', () => {
    expect(decodeProgressToken(null)).toBeNull();
    expect(decodeProgressToken(undefined)).toBeNull();
    expect(decodeProgressToken('')).toBeNull();
    expect(decodeProgressToken('short')).toBeNull();
    expect(decodeProgressToken('too-long-token-16')).toBeNull();
    expect(decodeProgressToken('AAAAAAAAAAAA+AA')).toBeNull();
    expect(decodeProgressToken('AAAAAAAAAAAA/AA')).toBeNull();
    expect(decodeProgressToken('AAAAAAAAAAAA=AA')).toBeNull();
    // Non-zero unused high bits (bits 85..88) or non-zero trailing pad bits
    expect(decodeProgressToken('_______________')).toBeNull();
    expect(decodeProgressToken('AAAAAAAAAAAAAAB')).toBeNull();
  });

  it('computes nextDay across empty, contiguous, gapped, wrap-around, and full states', () => {
    expect(computeNextDay([])).toBe(1);
    expect(computeNextDay(Array.from({ length: 53 }, (_, i) => i + 1))).toBe(54);
    expect(computeNextDay([1, 4])).toBe(5);
    expect(computeNextDay(Array.from({ length: 83 }, (_, i) => i + 2))).toBe(1);
    expect(computeNextDay([10, 84])).toBe(1);
    expect(computeNextDay(Array.from({ length: 84 }, (_, i) => i + 1))).toBeNull();
  });

  it('counts weekly completions and toggles days cleanly', () => {
    const days = [1, 2, 7, 8, 50, 51, 52, 53];
    expect(countWeekCompleted(days, 1)).toBe(3);
    expect(countWeekCompleted(days, 2)).toBe(1);
    expect(countWeekCompleted(days, 8)).toBe(4);
    expect(countWeekCompleted(days, 12)).toBe(0);

    expect(toggleDayInList([1, 54], 54)).toEqual([1]);
    expect(toggleDayInList([1, 54], 2)).toEqual([1, 2, 54]);
  });

  it('reads, writes, clears localStorage safely and constructs ?p= backup URLs', () => {
    const storage = createMemoryStorage();
    expect(readCompletedDays(storage)).toEqual([]);

    writeCompletedDays([54, 1, 54], storage);
    expect(storage.getItem(STORAGE_KEY)).toBe('[1,54]');
    expect(readCompletedDays(storage)).toEqual([1, 54]);

    storage.setItem(STORAGE_KEY, '{corrupt');
    expect(readCompletedDays(storage)).toEqual([]);

    const url = buildBackupUrl('https://user:secret@trainer.example/day/54?foo=bar#section', [1, 54]);
    const parsed = new URL(url);
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
    expect(parsed.hash).toBe('');
    expect(parsed.searchParams.get('foo')).toBeNull();
    expect(decodeProgressToken(parsed.searchParams.get('p'))).toEqual([1, 54]);

    clearCompletedDays(storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});
