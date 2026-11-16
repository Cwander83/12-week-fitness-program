import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  BookendBlock,
  DayData,
  DtpBlock,
  DtpExercise,
  ExerciseBlock,
  ExerciseEntry,
  GroupBlock,
  MuscleGroup,
  RestBlock,
  SetKind,
  SetPrescription,
  WeekData,
  WeekDaySummary,
  WorkoutBlock,
} from '../src/types/workout.js';

interface BulletNode {
  lineNumber: number;
  text: string;
  children: BulletNode[];
}

interface ParsedProgram {
  weeks: WeekData[];
  days: DayData[];
}

const WEEK_METADATA: Record<
  number,
  { phaseNumber: 1 | 2 | 3; phaseTitle: string; weekTheme: string }
> = {
  1: {
    phaseNumber: 1,
    phaseTitle: 'Hypertrophy Foundation',
    weekTheme: 'Foundation Failure & 21s',
  },
  2: {
    phaseNumber: 1,
    phaseTitle: 'Hypertrophy Foundation',
    weekTheme: 'Drop Sets & Giant Sets',
  },
  3: {
    phaseNumber: 1,
    phaseTitle: 'Hypertrophy Foundation',
    weekTheme: 'Rest-Pause & 100-Rep Drop',
  },
  4: {
    phaseNumber: 1,
    phaseTitle: 'Hypertrophy Foundation',
    weekTheme: 'Triple Drop Week',
  },
  5: {
    phaseNumber: 2,
    phaseTitle: 'High-Density Supersets',
    weekTheme: 'Drop-Set Supersets & 25m Cardio',
  },
  6: {
    phaseNumber: 2,
    phaseTitle: 'High-Density Supersets',
    weekTheme: 'Antagonistic & Alternating Supersets',
  },
  7: {
    phaseNumber: 2,
    phaseTitle: 'High-Density Supersets',
    weekTheme: '1.5 Reps & 7-Set Finishers',
  },
  8: {
    phaseNumber: 2,
    phaseTitle: 'High-Density Supersets',
    weekTheme: 'Pyramids & DTP Launch (Day 54)',
  },
  9: {
    phaseNumber: 3,
    phaseTitle: 'Peak DTP Shock',
    weekTheme: 'Smith DTP & 4-Superset Push/Pull',
  },
  10: {
    phaseNumber: 3,
    phaseTitle: 'Peak DTP Shock',
    weekTheme: 'Dual DTP Supersets & 4-Way Circuit',
  },
  11: {
    phaseNumber: 3,
    phaseTitle: 'Peak DTP Shock',
    weekTheme: 'Pure DTP Legs, Chest/Back & Press',
  },
  12: {
    phaseNumber: 3,
    phaseTitle: 'Peak DTP Shock',
    weekTheme: 'Final 1/2 DTP & Full DTP Peak',
  },
};

function stripBoldHeader(text: string): { label: string; rest: string } | null {
  const match = text.match(/^\*\*([^*]+):\*\*(?:\s*(.*))?$/);
  if (!match) return null;
  return {
    label: match[1].trim(),
    rest: (match[2] ?? '').trim(),
  };
}

function cleanRepsText(text: string): string {
  return text
    .replace(/\s+reps$/i, '')
    .trim();
}

export function parseSetPrescription(
  rawInput: string,
  forceKind?: SetKind,
  extraNotes?: string
): SetPrescription {
  const rawText = rawInput.trim();

  // Handle bold prefix such as "**Drop Set:** 5 sets of 10 reps"
  const boldInline = stripBoldHeader(rawText);
  if (boldInline && /^Drop Set$/i.test(boldInline.label)) {
    const inner = parseSetPrescription(boldInline.rest, 'drop', 'Drop Set');
    return {
      ...inner,
      rawText: `Drop Set: ${boldInline.rest}`,
    };
  }

  // Warm-up sets: "3–5 warm-up sets of 10–12 reps", "2 warm-up sets", "1 warm-up set of 8–10 reps (per arm)"
  const warmupMatch = rawText.match(
    /^(\d+(?:[–-]\d+)?)\s+warm-up\s+sets?(?:\s+of\s+(.+))?$/i
  );
  if (warmupMatch) {
    const countToken = warmupMatch[1];
    const body = warmupMatch[2]?.trim();
    const isSingleInt = /^\d+$/.test(countToken);
    const sets = isSingleInt ? Number(countToken) : undefined;
    const notesParts: string[] = [];
    if (!isSingleInt) {
      notesParts.push(`${countToken} sets`);
    }

    let reps = 'warm-up';
    if (body) {
      const parenMatch = body.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (parenMatch) {
        reps = cleanRepsText(parenMatch[1]);
        notesParts.push(parenMatch[2].trim());
      } else {
        reps = cleanRepsText(body);
      }
    }

    const combinedNotes = [extraNotes, ...notesParts].filter(Boolean).join(' · ');
    return {
      kind: 'warmup',
      ...(sets !== undefined ? { sets } : {}),
      reps,
      rawText,
      ...(combinedNotes ? { notes: combinedNotes } : {}),
    };
  }

  // Burnout set: "1 burnout set with partial reps"
  const burnoutMatch = rawText.match(/^(\d+)\s+burnout\s+sets?\s+with\s+(.+)$/i);
  if (burnoutMatch) {
    return {
      kind: 'burnout',
      sets: Number(burnoutMatch[1]),
      reps: burnoutMatch[2].trim(),
      rawText,
      notes: extraNotes ?? `with ${burnoutMatch[2].trim()}`,
    };
  }

  // Rest-pause sets: "3 rest-pause sets of 30 reps"
  const restPauseMatch = rawText.match(/^(\d+)\s+rest-pause\s+sets?\s+of\s+(.+)$/i);
  if (restPauseMatch) {
    return {
      kind: 'rest-pause',
      sets: Number(restPauseMatch[1]),
      reps: cleanRepsText(restPauseMatch[2]),
      rawText,
      ...(extraNotes ? { notes: extraNotes } : {}),
    };
  }

  // Triple drop sets: "3 triple drop sets of 12, 12, 12 reps"
  const tripleDropMatch = rawText.match(/^(\d+)\s+triple\s+drop\s+sets?\s+of\s+(.+)$/i);
  if (tripleDropMatch) {
    return {
      kind: 'triple-drop',
      sets: Number(tripleDropMatch[1]),
      reps: cleanRepsText(tripleDropMatch[2]),
      rawText,
      ...(extraNotes ? { notes: extraNotes } : {}),
    };
  }

  // Drop sets to failure: "1 drop set to failure", "2 drop sets to failure"
  const dropFailureMatch = rawText.match(/^(\d+)\s+drop\s+sets?\s+to\s+failure$/i);
  if (dropFailureMatch) {
    return {
      kind: 'drop',
      sets: Number(dropFailureMatch[1]),
      reps: 'to failure',
      rawText,
      ...(extraNotes ? { notes: extraNotes } : {}),
    };
  }

  // Drop sets of X: "1 drop set of 100 total reps", "3 drop sets of 10–12 reps + partial reps until failure"
  const dropOfMatch = rawText.match(/^(\d+)\s+drop\s+sets?\s+of\s+(.+)$/i);
  if (dropOfMatch) {
    const sets = Number(dropOfMatch[1]);
    let body = dropOfMatch[2].trim();
    const notesParts: string[] = [];

    const partialSuffixMatch = body.match(/^(.+?)\s*(\+\s*partial\s+reps\s+until\s+failure)$/i);
    if (partialSuffixMatch) {
      body = partialSuffixMatch[1].trim();
      notesParts.push(partialSuffixMatch[2].trim());
    }

    const combinedNotes = [extraNotes, ...notesParts].filter(Boolean).join(' · ');
    return {
      kind: 'drop',
      sets,
      reps: cleanRepsText(body),
      rawText,
      ...(combinedNotes ? { notes: combinedNotes } : {}),
    };
  }

  // Sets to failure without target: "2 sets to failure", "3 sets to failure", "1 set to failure"
  const failureBareMatch = rawText.match(/^(\d+)\s+sets?\s+to\s+failure$/i);
  if (failureBareMatch) {
    return {
      kind: forceKind ?? 'failure',
      sets: Number(failureBareMatch[1]),
      reps: 'to failure',
      rawText,
      ...(extraNotes ? { notes: extraNotes } : {}),
    };
  }

  // Sets to failure in X: "3 sets to failure in 10–12 reps"
  const failureInMatch = rawText.match(/^(\d+)\s+sets?\s+to\s+failure\s+in\s+(.+)$/i);
  if (failureInMatch) {
    return {
      kind: forceKind ?? 'failure',
      sets: Number(failureInMatch[1]),
      reps: cleanRepsText(failureInMatch[2]),
      rawText,
      ...(extraNotes ? { notes: extraNotes } : {}),
    };
  }

  // Working / failure / pyramid sets: "N set(s) of ..."
  const workingMatch = rawText.match(/^(\d+)\s+sets?\s+of\s+(.+)$/i);
  if (workingMatch) {
    const sets = Number(workingMatch[1]);
    let body = workingMatch[2].trim().replace(/:$/, '');
    let kind: SetKind = forceKind ?? 'working';
    const notesParts: string[] = [];

    // Extract trailing parenthetical note
    const parenMatch = body.match(/^(.+?)\s*\(([^)]+)\)$/);
    if (parenMatch) {
      body = parenMatch[1].trim();
      notesParts.push(parenMatch[2].trim());
    }

    // "20 reps to failure"
    const toFailureSuffix = body.match(/^(.+?)\s+to\s+failure$/i);
    if (toFailureSuffix) {
      body = toFailureSuffix[1].trim();
      if (!forceKind) kind = 'failure';
      notesParts.push('to failure');
    }

    // "12 reps and partial reps until failure"
    const partialFailMatch = body.match(/^(.+?)\s+and\s+(partial\s+reps\s+until\s+failure)$/i);
    if (partialFailMatch) {
      body = partialFailMatch[1].trim();
      if (!forceKind) kind = 'failure';
      notesParts.push(`and ${partialFailMatch[2].trim()}`);
    }

    // "12 reps + 20 partial reps"
    const plusPartialsMatch = body.match(/^(.+?)\s*\+\s*(\d+\s+partial\s+reps)$/i);
    if (plusPartialsMatch) {
      const base = cleanRepsText(plusPartialsMatch[1]);
      const extraCount = plusPartialsMatch[2].replace(/\s+reps$/i, 's').trim();
      notesParts.push(`+ ${plusPartialsMatch[2].trim()}`);
      const combinedNotes = [extraNotes, ...notesParts].filter(Boolean).join(' · ');
      return {
        kind,
        sets,
        reps: `${base} + ${extraCount}`,
        rawText,
        ...(combinedNotes ? { notes: combinedNotes } : {}),
      };
    }

    // "8–10 reps and 3 negative reps"
    const negativeMatch = body.match(/^(.+?)\s+and\s+(\d+\s+negative\s+reps)$/i);
    if (negativeMatch) {
      const base = cleanRepsText(negativeMatch[1]);
      notesParts.push(`and ${negativeMatch[2].trim()}`);
      const combinedNotes = [extraNotes, ...notesParts].filter(Boolean).join(' · ');
      return {
        kind,
        sets,
        reps: `${base} + ${negativeMatch[2].replace(/\s+reps$/i, 's').trim()}`,
        rawText,
        ...(combinedNotes ? { notes: combinedNotes } : {}),
      };
    }

    // "8–10 slow reps followed by 10 quick reps"
    const slowQuickMatch = body.match(
      /^(.+?)\s+slow\s+reps\s+followed\s+by\s+(\d+)\s+quick\s+reps$/i
    );
    if (slowQuickMatch) {
      notesParts.push(body);
      const combinedNotes = [extraNotes, ...notesParts].filter(Boolean).join(' · ');
      return {
        kind,
        sets,
        reps: `${slowQuickMatch[1].trim()} slow + ${slowQuickMatch[2].trim()} quick`,
        rawText,
        ...(combinedNotes ? { notes: combinedNotes } : {}),
      };
    }

    // '20 "One And A Half" reps'
    const oneHalfMatch = body.match(/^(\d+)\s+"One And A Half"\s+reps$/i);
    if (oneHalfMatch) {
      notesParts.push('"One And A Half" reps');
      const combinedNotes = [extraNotes, ...notesParts].filter(Boolean).join(' · ');
      return {
        kind,
        sets,
        reps: `${oneHalfMatch[1]} (1.5 reps)`,
        rawText,
        ...(combinedNotes ? { notes: combinedNotes } : {}),
      };
    }

    const combinedNotes = [extraNotes, ...notesParts].filter(Boolean).join(' · ');
    return {
      kind,
      sets,
      reps: cleanRepsText(body),
      rawText,
      ...(combinedNotes ? { notes: combinedNotes } : {}),
    };
  }

  throw new Error(`Unrecognized set prescription format: "${rawText}"`);
}

function buildBulletTree(lines: Array<{ lineNumber: number; raw: string }>): BulletNode[] {
  const roots: BulletNode[] = [];
  let lastLevel1: BulletNode | null = null;
  let lastLevel2: BulletNode | null = null;

  for (const { lineNumber, raw } of lines) {
    if (raw.trim() === '' || raw.trim() === '---') {
      continue;
    }

    const match = raw.match(/^( *)- (.+)$/);
    if (!match) {
      throw new Error(`Unexpected non-bullet line ${lineNumber}: "${raw}"`);
    }

    const indent = match[1].length;
    const text = match[2].trim();
    const node: BulletNode = { lineNumber, text, children: [] };

    if (indent === 0) {
      roots.push(node);
      lastLevel1 = node;
      lastLevel2 = null;
    } else if (indent === 2) {
      if (!lastLevel1) {
        throw new Error(`Orphan level-2 bullet at line ${lineNumber}: "${raw}"`);
      }
      lastLevel1.children.push(node);
      lastLevel2 = node;
    } else if (indent === 4) {
      if (!lastLevel2) {
        throw new Error(`Orphan level-3 bullet at line ${lineNumber}: "${raw}"`);
      }
      lastLevel2.children.push(node);
    } else {
      throw new Error(`Unexpected indentation (${indent} spaces) at line ${lineNumber}: "${raw}"`);
    }
  }

  return roots;
}

function isBookendNode(node: BulletNode): boolean {
  if (node.children.length > 0) return false;
  const header = stripBoldHeader(node.text);
  if (!header) return false;
  return /^Cardio(?:\s*\([^)]+\))?$/i.test(header.label) || /^Twists$/i.test(header.label);
}

function parseBookend(slot: 'pre' | 'post', nodes: BulletNode[]): BookendBlock {
  let cardio: string | undefined;
  let twists: string | undefined;
  const rawItems: string[] = [];

  for (const node of nodes) {
    const header = stripBoldHeader(node.text);
    if (!header || !header.rest) {
      throw new Error(`Invalid bookend bullet at line ${node.lineNumber}: "${node.text}"`);
    }
    rawItems.push(`${header.label}: ${header.rest}`);

    if (/^Cardio/i.test(header.label)) {
      const modeMatch = header.label.match(/^Cardio\s*\(([^)]+)\)$/i);
      cardio = modeMatch ? `${header.rest} (${modeMatch[1].trim()})` : header.rest;
    } else if (/^Twists$/i.test(header.label)) {
      twists = header.rest;
    }
  }

  return {
    type: 'bookend',
    slot,
    ...(cardio ? { cardio } : {}),
    ...(twists ? { twists } : {}),
    rawItems,
  };
}

function parseExerciseNameAndModifier(rawName: string): { name: string; modifier?: string } {
  const modMatch = rawName.match(/^(.+?)\s*\((21s)\)$/i);
  if (modMatch) {
    return { name: modMatch[1].trim(), modifier: modMatch[2].trim() };
  }
  return { name: rawName.trim() };
}

function parseExerciseEntryFromNode(node: BulletNode): ExerciseEntry {
  const header = stripBoldHeader(node.text);
  if (!header) {
    throw new Error(`Expected exercise header at line ${node.lineNumber}: "${node.text}"`);
  }

  const { name, modifier } = parseExerciseNameAndModifier(header.label);
  const prescriptions: SetPrescription[] = [];

  if (header.rest) {
    // Handles inline semicolon-separated prescriptions AND Day 28 "3 sets of 85 reps:" + sub-bullets
    if (node.children.length > 0) {
      const subDetails = node.children.map((child) => {
        if (child.children.length > 0) {
          throw new Error(
            `Unexpected deeper nesting under line ${child.lineNumber}: "${child.text}"`
          );
        }
        return child.text;
      });
      const baseText = header.rest.replace(/:$/, '').trim();
      prescriptions.push(parseSetPrescription(baseText, undefined, subDetails.join(' · ')));
    } else {
      const parts = header.rest
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of parts) {
        prescriptions.push(parseSetPrescription(part));
      }
    }
  } else {
    if (node.children.length === 0) {
      throw new Error(`Exercise has no prescriptions at line ${node.lineNumber}: "${node.text}"`);
    }
    for (const child of node.children) {
      const childHeader = stripBoldHeader(child.text);
      if (childHeader && /^Pyramid Set$/i.test(childHeader.label)) {
        if (child.children.length === 0) {
          throw new Error(`Empty Pyramid Set at line ${child.lineNumber}`);
        }
        for (const step of child.children) {
          if (step.children.length > 0) {
            throw new Error(`Unexpected nesting inside Pyramid Set at line ${step.lineNumber}`);
          }
          prescriptions.push(parseSetPrescription(step.text, 'pyramid-step', 'Pyramid Set'));
        }
      } else if (child.children.length > 0) {
        throw new Error(
          `Unexpected nested children at line ${child.lineNumber}: "${child.text}"`
        );
      } else {
        prescriptions.push(parseSetPrescription(child.text));
      }
    }
  }

  return {
    name,
    ...(modifier ? { modifier } : {}),
    prescriptions,
  };
}

function parseDtpBlock(node: BulletNode): DtpBlock {
  const header = stripBoldHeader(node.text);
  if (!header) {
    throw new Error(`Invalid DTP block at line ${node.lineNumber}: "${node.text}"`);
  }

  const label = header.label;
  let variant: DtpBlock['variant'];
  if (/^DTP Superset$/i.test(label)) {
    variant = 'dtp-superset';
  } else if (/^1\/2 DTP Superset$/i.test(label)) {
    variant = 'half-dtp-superset';
  } else if (/^1\/2 DTP Set$/i.test(label)) {
    variant = 'half-dtp-set';
  } else if (/^DTP Set$/i.test(label) || /^Leg Press \(DTP\)$/i.test(label)) {
    variant = 'dtp-set';
  } else {
    throw new Error(`Unknown DTP variant "${label}" at line ${node.lineNumber}`);
  }

  // Special case: Day 73 "- **Leg Press (DTP):**" has rep bullets directly as children
  if (/^Leg Press \(DTP\)$/i.test(label)) {
    const repWave: number[] = [];
    for (const child of node.children) {
      if (child.children.length > 0) {
        throw new Error(`Unexpected nesting in Day 73 DTP at line ${child.lineNumber}`);
      }
      const repMatch = child.text.match(/^1\s+set\s+of\s+(\d+)\s+reps$/i);
      if (!repMatch) {
        throw new Error(`Unexpected DTP line at ${child.lineNumber}: "${child.text}"`);
      }
      repWave.push(Number(repMatch[1]));
    }
    return {
      type: 'dtp',
      variant,
      label,
      exercises: [{ name: 'Leg Press', repWave }],
    };
  }

  const exercises: DtpExercise[] = [];
  for (const child of node.children) {
    const childHeader = stripBoldHeader(child.text);
    if (!childHeader) {
      throw new Error(`Expected exercise inside DTP at line ${child.lineNumber}: "${child.text}"`);
    }

    const warmup: SetPrescription[] = [];
    const repWave: number[] = [];
    const standardSets: SetPrescription[] = [];

    if (childHeader.rest) {
      if (child.children.length > 0) {
        throw new Error(`Unexpected mixed inline + nested DTP child at line ${child.lineNumber}`);
      }
      const parts = childHeader.rest
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        standardSets.push(parseSetPrescription(part));
      }
    } else {
      if (child.children.length === 0) {
        throw new Error(`Empty DTP exercise at line ${child.lineNumber}: "${child.text}"`);
      }
      for (const step of child.children) {
        if (step.children.length > 0) {
          throw new Error(`Unexpected 4th-level bullet at line ${step.lineNumber}`);
        }
        const waveMatch = step.text.match(/^1\s+set\s+of\s+(\d+)\s+reps$/i);
        if (waveMatch) {
          repWave.push(Number(waveMatch[1]));
        } else {
          const parsed = parseSetPrescription(step.text);
          if (parsed.kind === 'warmup') {
            warmup.push(parsed);
          } else {
            standardSets.push(parsed);
          }
        }
      }
    }

    if (repWave.length === 0 && standardSets.length === 0) {
      throw new Error(`DTP exercise "${childHeader.label}" parsed with no sets`);
    }

    exercises.push({
      name: childHeader.label,
      ...(warmup.length > 0 ? { warmup } : {}),
      repWave,
      ...(standardSets.length > 0 ? { standardSets } : {}),
    });
  }

  return {
    type: 'dtp',
    variant,
    label,
    exercises,
  };
}

function parseGroupBlock(node: BulletNode): GroupBlock {
  const header = stripBoldHeader(node.text);
  if (!header) {
    throw new Error(`Invalid group block at line ${node.lineNumber}: "${node.text}"`);
  }

  const match = header.label.match(/^(Superset|Giant Set|Circuit)(?:\s*\(([^)]+)\))?$/i);
  if (!match) {
    throw new Error(`Unknown group header "${header.label}" at line ${node.lineNumber}`);
  }

  const rawKind = match[1].toLowerCase();
  const groupKind: GroupBlock['groupKind'] =
    rawKind === 'superset'
      ? 'superset'
      : rawKind === 'giant set'
        ? 'giant-set'
        : 'circuit';

  if (node.children.length === 0) {
    throw new Error(`Empty group block "${header.label}" at line ${node.lineNumber}`);
  }

  const exercises = node.children.map((child) => parseExerciseEntryFromNode(child));

  return {
    type: 'group',
    groupKind,
    label: header.label,
    ...(match[2] ? { note: match[2].trim() } : {}),
    exercises,
  };
}

function inferMuscles(
  title: string,
  blocks: WorkoutBlock[],
  isRestDay: boolean
): { primaryMuscles: MuscleGroup[]; secondaryMuscles: MuscleGroup[] } {
  if (isRestDay) {
    return { primaryMuscles: [], secondaryMuscles: [] };
  }

  const lowerTitle = title.toLowerCase();
  const primarySet = new Set<MuscleGroup>();
  const secondarySet = new Set<MuscleGroup>();

  const exerciseNames = blocks
    .flatMap((block) => {
      if (block.type === 'exercise') return [block.name];
      if (block.type === 'group') return block.exercises.map((e) => e.name);
      if (block.type === 'dtp') return block.exercises.map((e) => e.name);
      return [];
    })
    .map((n) => n.toLowerCase());

  const hasExercise = (re: RegExp) => exerciseNames.some((n) => re.test(n));

  if (lowerTitle.includes('legs')) {
    primarySet.add('quads');
    primarySet.add('hamstrings');
    if (hasExercise(/calf/)) {
      primarySet.add('calves');
    }
    if (hasExercise(/squat|lunge|deadlift/)) {
      secondarySet.add('glutes');
    }
  }
  if (lowerTitle.includes('chest')) {
    primarySet.add('chest');
    secondarySet.add('shoulders');
    if (!lowerTitle.includes('triceps')) {
      secondarySet.add('triceps');
    }
  }
  if (lowerTitle.includes('back')) {
    primarySet.add('back');
    if (hasExercise(/hyperextension|deadlift|romanian/)) {
      secondarySet.add('glutes');
      if (!primarySet.has('hamstrings') && hasExercise(/romanian/)) {
        secondarySet.add('hamstrings');
      }
    }
    if (!lowerTitle.includes('biceps')) {
      secondarySet.add('biceps');
    }
  }
  if (lowerTitle.includes('shoulders')) {
    primarySet.add('shoulders');
    if (!lowerTitle.includes('triceps')) {
      secondarySet.add('triceps');
    }
  }
  if (lowerTitle.includes('biceps')) {
    primarySet.add('biceps');
  }
  if (lowerTitle.includes('triceps')) {
    primarySet.add('triceps');
  }
  if (lowerTitle.includes('calves')) {
    primarySet.add('calves');
  }
  if (lowerTitle.includes('abs')) {
    primarySet.add('abs');
  }

  // Ensure secondary never overlaps with primary
  for (const p of primarySet) {
    secondarySet.delete(p);
  }

  return {
    primaryMuscles: [...primarySet],
    secondaryMuscles: [...secondarySet],
  };
}

function buildShortSplit(title: string, isRestDay: boolean, restMode: DayData['restMode'], hasDtp: boolean, blocks: WorkoutBlock[]): string {
  if (isRestDay) {
    return restMode === 'active-recovery' ? 'Cardio' : 'Rest';
  }

  if (hasDtp) {
    const isHalf = blocks.some(
      (b) => b.type === 'dtp' && (b.variant === 'half-dtp-set' || b.variant === 'half-dtp-superset')
    );
    if (isHalf) return '1/2 DTP';
    if (title === 'Biceps / Triceps') return 'DTP Arm';
    if (title === 'Shoulders / Calves / Abs') return 'DTP Sh';
    if (title === 'Legs') return 'DTP Leg';
    if (title === 'Chest / Back') return 'DTP C/B';
    return 'DTP';
  }

  const map: Record<string, string> = {
    Legs: 'Legs',
    'Chest / Triceps': 'Ch/Tri',
    'Chest / Triceps / Abs': 'Ch/Tri',
    'Back / Biceps': 'Bk/Bi',
    'Back / Biceps / Abs': 'Bk/Bi',
    'Shoulders / Calves / Abs': 'Sh/Clv',
    'Shoulders / Calves': 'Sh/Clv',
    Shoulders: 'Shld',
    'Calves / Abs': 'Clv/Ab',
    'Abs / Calves': 'Ab/Clv',
    Chest: 'Chest',
    'Triceps / Calves / Abs': 'Tri/Ab',
    'Back / Chest': 'Bk/Ch',
    'Chest / Back': 'Ch/Bk',
    'Biceps / Triceps': 'Bi/Tri',
    'Legs / Shoulders': 'Lg/Sh',
    'Back / Biceps / Triceps': 'Bk/Arm',
  };

  if (map[title]) return map[title];
  throw new Error(`No shortSplit mapping defined for workout title "${title}"`);
}

function summarizeWeekBookends(days: DayData[]): {
  cardioSummary: string;
  twistsSummary: string;
} {
  const cardioValues = new Set<string>();
  const twistsValues = new Set<string>();

  for (const day of days) {
    for (const block of day.blocks) {
      if (block.type === 'bookend') {
        if (block.cardio) {
          const minMatch = block.cardio.match(/^(\d+)\s*minutes/i);
          cardioValues.add(minMatch ? minMatch[1] : block.cardio);
        }
        if (block.twists) {
          const twistMatch = block.twists.match(/(\d+)\s*reps/i);
          twistsValues.add(twistMatch ? twistMatch[1] : block.twists);
        }
      }
    }
  }

  const mins = [...cardioValues].sort((a, b) => Number(a) - Number(b));
  const cardioSummary =
    mins.length === 1
      ? `${mins[0]} min pre & post`
      : `${mins.join('–')} min pre & post`;

  const twistsSummary =
    twistsValues.size === 0 ? 'None' : `${[...twistsValues][0]} pre & post`;

  return { cardioSummary, twistsSummary };
}

export function parseProgramMarkdown(markdown: string): ParsedProgram {
  const lines = markdown.split(/\r?\n/);

  let currentWeek = 0;
  let currentDayNumber = 0;
  let currentDayHeading = '';
  let currentDayLines: Array<{ lineNumber: number; raw: string }> = [];

  const rawDays: Array<{
    weekNumber: number;
    dayNumber: number;
    headingTitle: string;
    lines: Array<{ lineNumber: number; raw: string }>;
  }> = [];

  const flushDay = () => {
    if (currentDayNumber === 0) return;
    rawDays.push({
      weekNumber: currentWeek,
      dayNumber: currentDayNumber,
      headingTitle: currentDayHeading,
      lines: currentDayLines,
    });
    currentDayLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();

    if (lineNumber === 1 && trimmed.startsWith('# ')) {
      continue;
    }

    const weekMatch = trimmed.match(/^## Week (\d+)$/);
    if (weekMatch) {
      flushDay();
      currentDayNumber = 0;
      currentWeek = Number(weekMatch[1]);
      continue;
    }

    const dayMatch = trimmed.match(/^### Day (\d+): (.+)$/);
    if (dayMatch) {
      flushDay();
      if (currentWeek === 0) {
        throw new Error(`Day found before Week heading at line ${lineNumber}`);
      }
      currentDayNumber = Number(dayMatch[1]);
      currentDayHeading = dayMatch[2].trim();
      continue;
    }

    if (currentDayNumber > 0) {
      currentDayLines.push({ lineNumber, raw });
    } else if (trimmed !== '' && trimmed !== '---') {
      throw new Error(`Unexpected content outside day block at line ${lineNumber}: "${raw}"`);
    }
  }
  flushDay();

  if (rawDays.length !== 84) {
    throw new Error(`Expected 84 days, parsed ${rawDays.length}`);
  }

  const days: DayData[] = rawDays.map((entry, idx) => {
    const expectedDayNumber = idx + 1;
    if (entry.dayNumber !== expectedDayNumber) {
      throw new Error(`Expected Day ${expectedDayNumber}, found Day ${entry.dayNumber}`);
    }

    const expectedWeek = Math.ceil(entry.dayNumber / 7);
    if (entry.weekNumber !== expectedWeek) {
      throw new Error(
        `Day ${entry.dayNumber} under Week ${entry.weekNumber}, expected Week ${expectedWeek}`
      );
    }

    const phaseNumber = (Math.ceil(entry.weekNumber / 4) as 1 | 2 | 3);
    const tree = buildBulletTree(entry.lines);
    if (tree.length === 0) {
      throw new Error(`Day ${entry.dayNumber} has zero workout bullets`);
    }

    const id = `day-${String(entry.dayNumber).padStart(2, '0')}`;

    if (entry.headingTitle === 'Rest') {
      const isFullRest =
        tree.length === 1 && tree[0].text === 'Rest' && tree[0].children.length === 0;
      const restMode: 'full-rest' | 'active-recovery' = isFullRest
        ? 'full-rest'
        : 'active-recovery';

      const items: string[] = [];
      if (isFullRest) {
        items.push('Rest');
      } else {
        for (const node of tree) {
          if (node.children.length > 0) {
            throw new Error(`Unexpected sub-bullets on Rest Day ${entry.dayNumber}`);
          }
          const h = stripBoldHeader(node.text);
          if (!h || (!/^Cardio/i.test(h.label) && !/^Twists$/i.test(h.label))) {
            throw new Error(
              `Unexpected Rest Day item on Day ${entry.dayNumber}: "${node.text}"`
            );
          }
          items.push(`${h.label}: ${h.rest}`);
        }
      }

      let title = 'Rest';
      if (!isFullRest) {
        const joined = items.join(' ').toLowerCase();
        if (joined.includes('morning') || joined.includes('evening')) {
          title = 'Rest (Cardio AM/PM)';
        } else if (joined.includes('daily cardio')) {
          title = 'Rest (Daily Cardio)';
        } else {
          title = 'Rest (Active Cardio)';
        }
      }

      const restBlock: RestBlock = {
        type: 'rest',
        mode: restMode,
        items,
      };

      return {
        id,
        dayNumber: entry.dayNumber,
        weekNumber: entry.weekNumber,
        phaseNumber,
        title,
        shortSplit: buildShortSplit(title, true, restMode, false, [restBlock]),
        isRestDay: true,
        restMode,
        primaryMuscles: [],
        secondaryMuscles: [],
        hasDtp: false,
        hasSupersetOrGiant: false,
        blocks: [restBlock],
      };
    }

    // Non-rest workout day
    let startIdx = 0;
    while (startIdx < tree.length && isBookendNode(tree[startIdx])) {
      startIdx++;
    }

    let endIdx = tree.length;
    while (endIdx > startIdx && isBookendNode(tree[endIdx - 1])) {
      endIdx--;
    }

    const preNodes = tree.slice(0, startIdx);
    const middleNodes = tree.slice(startIdx, endIdx);
    const postNodes = tree.slice(endIdx);

    if (middleNodes.length === 0) {
      throw new Error(`Workout Day ${entry.dayNumber} has no lifting blocks`);
    }

    const blocks: WorkoutBlock[] = [];
    if (preNodes.length > 0) {
      blocks.push(parseBookend('pre', preNodes));
    }

    for (const node of middleNodes) {
      const header = stripBoldHeader(node.text);
      if (!header) {
        throw new Error(
          `Expected bold workout block at line ${node.lineNumber}: "${node.text}"`
        );
      }

      if (
        /^(DTP Set|DTP Superset|1\/2 DTP Set|1\/2 DTP Superset|Leg Press \(DTP\))$/i.test(
          header.label
        )
      ) {
        blocks.push(parseDtpBlock(node));
      } else if (/^(Superset|Giant Set|Circuit)(?:\s*\([^)]+\))?$/i.test(header.label)) {
        blocks.push(parseGroupBlock(node));
      } else {
        const parsed = parseExerciseEntryFromNode(node);
        const exerciseBlock: ExerciseBlock = {
          type: 'exercise',
          name: parsed.name,
          ...(parsed.modifier ? { modifier: parsed.modifier } : {}),
          prescriptions: parsed.prescriptions,
        };
        blocks.push(exerciseBlock);
      }
    }

    if (postNodes.length > 0) {
      blocks.push(parseBookend('post', postNodes));
    }

    const hasDtp = blocks.some((b) => b.type === 'dtp');
    const hasSupersetOrGiant = blocks.some((b) => b.type === 'group');
    const { primaryMuscles, secondaryMuscles } = inferMuscles(
      entry.headingTitle,
      blocks,
      false
    );

    return {
      id,
      dayNumber: entry.dayNumber,
      weekNumber: entry.weekNumber,
      phaseNumber,
      title: entry.headingTitle,
      shortSplit: buildShortSplit(entry.headingTitle, false, undefined, hasDtp, blocks),
      isRestDay: false,
      primaryMuscles,
      secondaryMuscles,
      hasDtp,
      hasSupersetOrGiant,
      blocks,
    };
  });

  const weeks: WeekData[] = [];
  for (let w = 1; w <= 12; w++) {
    const meta = WEEK_METADATA[w];
    const weekDays = days.filter((d) => d.weekNumber === w);
    if (weekDays.length !== 7) {
      throw new Error(`Week ${w} has ${weekDays.length} days instead of 7`);
    }

    const workoutDaysCount = weekDays.filter((d) => !d.isRestDay).length;
    const restDaysCount = weekDays.filter((d) => d.isRestDay).length;
    const { cardioSummary, twistsSummary } = summarizeWeekBookends(weekDays);

    const summaries: WeekDaySummary[] = weekDays.map((d) => ({
      dayNumber: d.dayNumber,
      title: d.title,
      shortSplit: d.shortSplit,
      isRestDay: d.isRestDay,
      ...(d.restMode ? { restMode: d.restMode } : {}),
      hasDtp: d.hasDtp,
    }));

    weeks.push({
      id: `week-${String(w).padStart(2, '0')}`,
      weekNumber: w,
      phaseNumber: meta.phaseNumber,
      phaseTitle: meta.phaseTitle,
      weekTheme: meta.weekTheme,
      startDay: weekDays[0].dayNumber,
      endDay: weekDays[weekDays.length - 1].dayNumber,
      workoutDaysCount,
      restDaysCount,
      cardioSummary,
      twistsSummary,
      days: summaries,
    });
  }

  return { weeks, days };
}

export function compileWorkoutsToDisk(projectRoot?: string): ParsedProgram {
  const root =
    projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const rawPath = resolve(root, 'src/data/raw/12-week-program.md');
  const weeksDir = resolve(root, 'src/content/weeks');
  const daysDir = resolve(root, 'src/content/days');

  const markdown = readFileSync(rawPath, 'utf8');
  const parsed = parseProgramMarkdown(markdown);

  mkdirSync(weeksDir, { recursive: true });
  mkdirSync(daysDir, { recursive: true });

  for (const existing of readdirSync(weeksDir)) {
    if (existing.endsWith('.json')) {
      rmSync(resolve(weeksDir, existing));
    }
  }
  for (const existing of readdirSync(daysDir)) {
    if (existing.endsWith('.json')) {
      rmSync(resolve(daysDir, existing));
    }
  }

  for (const week of parsed.weeks) {
    const outPath = resolve(weeksDir, `${week.id}.json`);
    writeFileSync(outPath, `${JSON.stringify(week, null, 2)}\n`, 'utf8');
  }

  for (const day of parsed.days) {
    const outPath = resolve(daysDir, `${day.id}.json`);
    writeFileSync(outPath, `${JSON.stringify(day, null, 2)}\n`, 'utf8');
  }

  return parsed;
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  const { weeks, days } = compileWorkoutsToDisk();
  console.log(`Compiled ${weeks.length} weeks and ${days.length} days into src/content/.`);
}
