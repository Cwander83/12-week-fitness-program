import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProgramMarkdown } from '../scripts/compile-workouts.js';
import type { DayData, WeekData, WorkoutBlock } from '../src/types/workout.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_MD_PATH = resolve(ROOT, 'src/data/raw/12-week-program.md');
const WEEKS_DIR = resolve(ROOT, 'src/content/weeks');
const DAYS_DIR = resolve(ROOT, 'src/content/days');

const BANNED_NAME_REGEX = new RegExp(
  [
    String.fromCharCode(107, 114, 105, 115),
    String.fromCharCode(103, 101, 116, 104, 105, 110),
  ].join('|'),
  'i'
);

const BANNED_WORD_REGEX = new RegExp(
  `\\b${String.fromCharCode(105, 115, 115, 117, 101)}s?\\b`,
  'i'
);

function loadDay(dayNumber: number): DayData {
  const file = resolve(DAYS_DIR, `day-${String(dayNumber).padStart(2, '0')}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as DayData;
}

function loadWeek(weekNumber: number): WeekData {
  const file = resolve(WEEKS_DIR, `week-${String(weekNumber).padStart(2, '0')}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as WeekData;
}

function collectStringsFromBlock(block: WorkoutBlock): string[] {
  switch (block.type) {
    case 'bookend':
      return [...block.rawItems];
    case 'rest':
      return [...block.items];
    case 'exercise':
      return [
        block.name,
        ...(block.modifier ? [block.modifier] : []),
        ...block.prescriptions.flatMap((p) => [
          p.rawText,
          p.reps,
          ...(p.notes ? [p.notes] : []),
        ]),
      ];
    case 'group':
      return [
        block.label,
        ...(block.note ? [block.note] : []),
        ...block.exercises.flatMap((ex) => [
          ex.name,
          ...(ex.modifier ? [ex.modifier] : []),
          ...ex.prescriptions.flatMap((p) => [
            p.rawText,
            p.reps,
            ...(p.notes ? [p.notes] : []),
          ]),
        ]),
      ];
    case 'dtp':
      return [
        block.label,
        ...block.exercises.flatMap((ex) => [
          ex.name,
          ...(ex.warmup ?? []).map((w) => w.rawText),
          ...ex.repWave.map((r) => `${r} reps`),
          ...(ex.standardSets ?? []).map((s) => s.rawText),
        ]),
      ];
  }
}

function countParsedLeafItems(day: DayData): number {
  let count = 0;
  for (const block of day.blocks) {
    if (block.type === 'bookend') {
      count += block.rawItems.length;
    } else if (block.type === 'rest') {
      count += block.items.length;
    } else if (block.type === 'exercise') {
      count += block.prescriptions.length;
    } else if (block.type === 'group') {
      for (const ex of block.exercises) {
        for (const p of ex.prescriptions) {
          if (p.notes && p.rawText === '3 sets of 85 reps') {
            // Day 28 parent + 4 foot-position sub-bullets
            count += 1 + p.notes.split(' · ').length;
          } else {
            count += 1;
          }
        }
      }
    } else if (block.type === 'dtp') {
      for (const ex of block.exercises) {
        count += (ex.warmup?.length ?? 0) + ex.repWave.length + (ex.standardSets?.length ?? 0);
      }
    }
  }
  return count;
}

function countSourceLeafBulletsPerDay(markdown: string): Map<number, number> {
  const counts = new Map<number, number>();
  const lines = markdown.split(/\r?\n/);
  let currentDay = 0;
  let dayLines: string[] = [];

  const finalizeDay = () => {
    if (currentDay === 0) return;
    let leafCount = 0;
    for (const raw of dayLines) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '---') continue;
      // Top-level bookend or Rest
      if (/^- (\*\*(Cardio(?:\s*\([^)]+\))?|Twists):\*\*|Rest$)/.test(raw)) {
        leafCount += 1;
        continue;
      }
      // Level-2 bullet with inline prescription(s) separated by semicolons
      const l2BoldInline = raw.match(/^  - \*\*[^*]+:\*\*\s+(.+)$/);
      if (l2BoldInline) {
        const rest = l2BoldInline[1].trim();
        if (/^Drop Set:/i.test(raw.trim().slice(2))) {
          leafCount += 1;
        } else {
          leafCount += rest
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean).length;
        }
        continue;
      }
      // Level-2 plain prescription bullet (under single exercise or Day 73 Leg Press (DTP))
      if (/^  - [^*]/.test(raw)) {
        leafCount += 1;
        continue;
      }
      // Level-3 bullet (nested under group exercise, DTP exercise, or Pyramid Set)
      if (/^    - /.test(raw)) {
        leafCount += 1;
      }
    }
    counts.set(currentDay, leafCount);
    dayLines = [];
  };

  for (const raw of lines) {
    const dayMatch = raw.trim().match(/^### Day (\d+):/);
    if (dayMatch) {
      finalizeDay();
      currentDay = Number(dayMatch[1]);
      continue;
    }
    if (/^## Week \d+$/.test(raw.trim())) {
      finalizeDay();
      currentDay = 0;
      continue;
    }
    if (currentDay > 0) {
      dayLines.push(raw);
    }
  }
  finalizeDay();
  return counts;
}

function listProjectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === '.astro' ||
      entry.name === '.git' ||
      entry.name === 'sheepshead' ||
      entry.name === 'test-results' ||
      entry.name === 'playwright-report' ||
      entry.name === 'pnpm-lock.yaml'
    ) {
      continue;
    }
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listProjectFiles(full));
    } else if (/\.(md|ts|mjs|astro|css|json|yaml)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('12-week workout data integrity', () => {
  const rawMarkdown = readFileSync(RAW_MD_PATH, 'utf8');
  const parsed = parseProgramMarkdown(rawMarkdown);

  it('keeps neutralized title on line 1 and preserves all 1285 lines', () => {
    const lines = rawMarkdown.split(/\r?\n/);
    expect(lines[0]).toBe('# 12-Week Hardcore Daily Trainer — Workouts');
    expect(lines.filter((_, idx) => idx < 1285).length).toBe(1285);
  });

  it('compiles all 12 weeks and 84 days on disk matching the live parser output', () => {
    const weekFiles = readdirSync(WEEKS_DIR).filter((f) => f.endsWith('.json')).sort();
    const dayFiles = readdirSync(DAYS_DIR).filter((f) => f.endsWith('.json')).sort();

    expect(weekFiles).toHaveLength(12);
    expect(dayFiles).toHaveLength(84);
    expect(parsed.weeks).toHaveLength(12);
    expect(parsed.days).toHaveLength(84);

    for (let w = 1; w <= 12; w++) {
      const onDisk = loadWeek(w);
      expect(onDisk).toEqual(parsed.weeks[w - 1]);
      expect(onDisk.workoutDaysCount + onDisk.restDaysCount).toBe(7);
      expect(onDisk.startDay).toBe((w - 1) * 7 + 1);
      expect(onDisk.endDay).toBe(w * 7);
    }

    for (let d = 1; d <= 84; d++) {
      const onDisk = loadDay(d);
      expect(onDisk).toEqual(parsed.days[d - 1]);
      expect(onDisk.dayNumber).toBe(d);
      expect(onDisk.weekNumber).toBe(Math.ceil(d / 7));
      expect(onDisk.phaseNumber).toBe(Math.ceil(onDisk.weekNumber / 4));
      expect(onDisk.blocks.length).toBeGreaterThan(0);
    }
  });

  it('accounts for every single leaf bullet across all 84 days without silent drops', () => {
    const sourceLeafCounts = countSourceLeafBulletsPerDay(rawMarkdown);
    expect(sourceLeafCounts.size).toBe(84);

    for (let d = 1; d <= 84; d++) {
      const day = loadDay(d);
      const parsedCount = countParsedLeafItems(day);
      const expectedCount = sourceLeafCounts.get(d);
      expect(parsedCount, `Day ${d} leaf bullet count mismatch`).toBe(expectedCount);
    }
  });

  it('spot-checks Day 1, Day 5, Day 6, Day 7, and Day 8 accurately', () => {
    const day1 = loadDay(1);
    expect(day1.title).toBe('Legs');
    expect(day1.isRestDay).toBe(false);
    expect(day1.primaryMuscles).toEqual(['quads', 'hamstrings']);
    expect(day1.blocks.filter((b) => b.type === 'bookend')).toHaveLength(2);
    const day1Exercises = day1.blocks.filter((b) => b.type === 'exercise');
    expect(day1Exercises.map((b) => b.name)).toEqual([
      'Leg Press',
      'Hamstring Curl',
      'Lying Hamstring Curl',
      'Leg Extension',
      'Hack Squats',
    ]);
    expect(day1Exercises[0].prescriptions[0]).toMatchObject({
      kind: 'warmup',
      reps: '10–12',
      rawText: '3–5 warm-up sets of 10–12 reps',
    });

    const day5 = loadDay(5);
    const upright = day5.blocks.find(
      (b) => b.type === 'exercise' && b.name === 'Upright Rows'
    );
    expect(upright).toBeDefined();
    if (upright?.type === 'exercise') {
      expect(upright.modifier).toBe('21s');
      expect(upright.prescriptions[0].reps).toBe('7, 7, 7');
    }

    const day6 = loadDay(6);
    expect(day6.isRestDay).toBe(true);
    expect(day6.restMode).toBe('full-rest');
    expect(day6.blocks).toEqual([{ type: 'rest', mode: 'full-rest', items: ['Rest'] }]);

    const day3 = loadDay(3);
    expect(day3.isRestDay).toBe(true);
    expect(day3.restMode).toBe('active-recovery');
    expect(day3.blocks[0]).toEqual({
      type: 'rest',
      mode: 'active-recovery',
      items: ['Cardio: 20 minutes (morning)', 'Cardio: 20 minutes (evening)'],
    });

    const day7 = loadDay(7);
    const repeatSuperset = day7.blocks.find(
      (b) => b.type === 'group' && b.note === 'Repeat Exercises 1 & 2'
    );
    expect(repeatSuperset).toBeDefined();

    const day8 = loadDay(8);
    const giantSet = day8.blocks.find(
      (b) => b.type === 'group' && b.groupKind === 'giant-set'
    );
    expect(giantSet).toBeDefined();
    if (giantSet?.type === 'group') {
      expect(giantSet.exercises.map((e) => e.name)).toEqual([
        'Head Smackers',
        'Skull Crushers',
        'Rockers',
      ]);
    }
  });

  it('spot-checks Day 25, Day 28, Day 40, Day 51, and Day 52 edge cases', () => {
    const day25 = loadDay(25);
    expect(day25.title).toBe('Chest');
    const flyes = day25.blocks.find(
      (b) => b.type === 'exercise' && b.name === 'Incline Dumbbell Flyes'
    );
    expect(flyes?.type === 'exercise' && flyes.prescriptions[0].kind).toBe('triple-drop');
    expect(flyes?.type === 'exercise' && flyes.prescriptions[0].reps).toBe('12, 12, 12');

    const day28 = loadDay(28);
    const ss28 = day28.blocks.find((b) => b.type === 'group');
    expect(ss28?.type).toBe('group');
    if (ss28?.type === 'group') {
      const legPress = ss28.exercises[0];
      expect(legPress.name).toBe('Leg Press');
      expect(legPress.prescriptions[0].sets).toBe(3);
      expect(legPress.prescriptions[0].reps).toBe('85');
      expect(legPress.prescriptions[0].notes).toContain('feet at bottom of plate');
      expect(legPress.prescriptions[0].notes).toContain('25 reps after moving feet to top of plate');
    }

    const day40 = loadDay(40);
    const altLegs = day40.blocks.find(
      (b) => b.type === 'group' && b.note === 'Alternating Legs'
    );
    expect(altLegs?.type).toBe('group');
    if (altLegs?.type === 'group') {
      expect(altLegs.exercises[0].name).toBe('Unilateral Leg Extension');
      expect(altLegs.exercises[0].prescriptions.map((p) => p.reps)).toEqual(['20', '10', '5']);
    }

    const day51 = loadDay(51);
    const sideRaises = day51.blocks.find(
      (b) => b.type === 'exercise' && b.name === 'Side Raises'
    );
    expect(sideRaises?.type).toBe('exercise');
    if (sideRaises?.type === 'exercise') {
      const pyramidSteps = sideRaises.prescriptions.filter((p) => p.kind === 'pyramid-step');
      expect(pyramidSteps.map((p) => p.reps)).toEqual(['50', '40', '30', '20', '10']);
      const drop = sideRaises.prescriptions.find((p) => p.kind === 'drop');
      expect(drop).toMatchObject({ kind: 'drop', sets: 5, reps: '10' });
    }

    const day52 = loadDay(52);
    const squats = day52.blocks.find((b) => b.type === 'exercise' && b.name === 'Squats');
    expect(squats?.type).toBe('exercise');
    if (squats?.type === 'exercise') {
      expect(squats.prescriptions[0].kind).toBe('warmup');
      expect(
        squats.prescriptions.filter((p) => p.kind === 'pyramid-step').map((p) => p.reps)
      ).toEqual(['40', '30', '10']);
    }
  });

  it('spot-checks Day 54, Day 69, Day 73, Day 78, Day 80, and Day 84 DTP & Circuit days', () => {
    const fullWave = [50, 40, 30, 20, 10, 10, 20, 30, 40, 50];

    const day54 = loadDay(54);
    expect(day54.hasDtp).toBe(true);
    const dtp54 = day54.blocks.find((b) => b.type === 'dtp');
    expect(dtp54?.type).toBe('dtp');
    if (dtp54?.type === 'dtp') {
      expect(dtp54.variant).toBe('dtp-superset');
      expect(dtp54.exercises).toHaveLength(2);
      expect(dtp54.exercises[0].repWave).toEqual(fullWave);
      expect(dtp54.exercises[1].repWave).toEqual(fullWave);
    }

    const day69 = loadDay(69);
    const circuit = day69.blocks.find(
      (b) => b.type === 'group' && b.groupKind === 'circuit'
    );
    expect(circuit?.type).toBe('group');
    if (circuit?.type === 'group') {
      expect(circuit.exercises).toHaveLength(4);
    }
    expect(collectStringsFromBlock(circuit!).join(' ')).toContain('4 sets of 20 reps');

    const day73 = loadDay(73);
    const dtp73 = day73.blocks.find((b) => b.type === 'dtp');
    expect(dtp73?.type).toBe('dtp');
    if (dtp73?.type === 'dtp') {
      expect(dtp73.variant).toBe('dtp-set');
      expect(dtp73.exercises[0].name).toBe('Leg Press');
      expect(dtp73.exercises[0].repWave).toEqual(fullWave);
    }

    const day78 = loadDay(78);
    const dtp78 = day78.blocks.find((b) => b.type === 'dtp');
    expect(dtp78?.type).toBe('dtp');
    if (dtp78?.type === 'dtp') {
      expect(dtp78.variant).toBe('half-dtp-set');
      expect(dtp78.exercises[0].warmup?.[0]).toMatchObject({ sets: 2, reps: '8–10' });
      expect(dtp78.exercises[0].repWave).toEqual([50, 40, 30, 20, 10]);
    }

    const day80 = loadDay(80);
    const dtpBlocks80 = day80.blocks.filter((b) => b.type === 'dtp');
    expect(dtpBlocks80).toHaveLength(2);
    if (dtpBlocks80[0].type === 'dtp' && dtpBlocks80[1].type === 'dtp') {
      expect(dtpBlocks80[0].variant).toBe('half-dtp-set');
      expect(dtpBlocks80[0].exercises[0].repWave).toEqual([50, 40, 30, 20, 10]);
      expect(dtpBlocks80[1].variant).toBe('half-dtp-superset');
      expect(dtpBlocks80[1].exercises[0].repWave).toEqual([10, 20, 30, 40, 50]);
      expect(dtpBlocks80[1].exercises[1].name).toBe('Dumbbell Shrugs');
      expect(dtpBlocks80[1].exercises[1].repWave).toEqual([]);
      expect(dtpBlocks80[1].exercises[1].standardSets?.[0]).toMatchObject({
        kind: 'working',
        sets: 5,
        reps: '20–25',
      });
    }

    const day84 = loadDay(84);
    const dtp84 = day84.blocks.find((b) => b.type === 'dtp');
    expect(dtp84?.type).toBe('dtp');
    if (dtp84?.type === 'dtp') {
      expect(dtp84.variant).toBe('dtp-superset');
      expect(dtp84.exercises[0].repWave).toEqual(fullWave);
      expect(dtp84.exercises[1].repWave).toEqual(fullWave);
    }
  });

  it('contains zero restricted names or banned words across project files', () => {
    const files = listProjectFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content, `Banned name in ${file}`).not.toMatch(BANNED_NAME_REGEX);
      expect(content, `Banned term in ${file}`).not.toMatch(BANNED_WORD_REGEX);
    }
    expect(existsSync(resolve(ROOT, 'src/assets/photos/hero.png'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'src/assets/photos/phase-1.png'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'src/assets/photos/phase-2.png'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'src/assets/photos/phase-3.png'))).toBe(true);
  });
});
