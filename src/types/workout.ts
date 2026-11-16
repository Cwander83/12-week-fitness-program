export type MuscleGroup =
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'abs';

export type SetKind =
  | 'warmup'
  | 'working'
  | 'failure'
  | 'drop'
  | 'triple-drop'
  | 'rest-pause'
  | 'burnout'
  | 'pyramid-step';

export interface SetPrescription {
  kind: SetKind;
  sets?: number;
  reps: string;
  rawText: string;
  notes?: string;
}

export interface ExerciseEntry {
  name: string;
  modifier?: string;
  prescriptions: SetPrescription[];
}

export interface BookendBlock {
  type: 'bookend';
  slot: 'pre' | 'post';
  cardio?: string;
  twists?: string;
  rawItems: string[];
}

export interface ExerciseBlock {
  type: 'exercise';
  name: string;
  modifier?: string;
  prescriptions: SetPrescription[];
}

export interface GroupBlock {
  type: 'group';
  groupKind: 'superset' | 'giant-set' | 'circuit';
  label: string;
  note?: string;
  exercises: ExerciseEntry[];
}

export interface DtpExercise {
  name: string;
  warmup?: SetPrescription[];
  repWave: number[];
  standardSets?: SetPrescription[];
}

export interface DtpBlock {
  type: 'dtp';
  variant: 'dtp-set' | 'dtp-superset' | 'half-dtp-set' | 'half-dtp-superset';
  label: string;
  exercises: DtpExercise[];
}

export interface RestBlock {
  type: 'rest';
  mode: 'full-rest' | 'active-recovery';
  items: string[];
}

export type WorkoutBlock =
  | BookendBlock
  | ExerciseBlock
  | GroupBlock
  | DtpBlock
  | RestBlock;

export interface DayData {
  id: string;
  dayNumber: number;
  weekNumber: number;
  phaseNumber: 1 | 2 | 3;
  title: string;
  shortSplit: string;
  isRestDay: boolean;
  restMode?: 'full-rest' | 'active-recovery';
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  hasDtp: boolean;
  hasSupersetOrGiant: boolean;
  blocks: WorkoutBlock[];
}

export interface WeekDaySummary {
  dayNumber: number;
  title: string;
  shortSplit: string;
  isRestDay: boolean;
  restMode?: 'full-rest' | 'active-recovery';
  hasDtp: boolean;
}

export interface WeekData {
  id: string;
  weekNumber: number;
  phaseNumber: 1 | 2 | 3;
  phaseTitle: string;
  weekTheme: string;
  startDay: number;
  endDay: number;
  workoutDaysCount: number;
  restDaysCount: number;
  cardioSummary: string;
  twistsSummary: string;
  days: WeekDaySummary[];
}
