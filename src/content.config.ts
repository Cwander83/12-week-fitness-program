import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const muscleGroupSchema = z.enum([
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'abs',
]);

const setKindSchema = z.enum([
  'warmup',
  'working',
  'failure',
  'drop',
  'triple-drop',
  'rest-pause',
  'burnout',
  'pyramid-step',
]);

const setPrescriptionSchema = z
  .object({
    kind: setKindSchema,
    sets: z.number().int().positive().optional(),
    reps: z.string().min(1),
    rawText: z.string().min(1),
    notes: z.string().min(1).optional(),
  })
  .strict();

const exerciseEntrySchema = z
  .object({
    name: z.string().min(1),
    modifier: z.string().min(1).optional(),
    prescriptions: z.array(setPrescriptionSchema).min(1),
  })
  .strict();

const bookendBlockSchema = z
  .object({
    type: z.literal('bookend'),
    slot: z.enum(['pre', 'post']),
    cardio: z.string().min(1).optional(),
    twists: z.string().min(1).optional(),
    rawItems: z.array(z.string().min(1)).min(1),
  })
  .strict();

const exerciseBlockSchema = z
  .object({
    type: z.literal('exercise'),
    name: z.string().min(1),
    modifier: z.string().min(1).optional(),
    prescriptions: z.array(setPrescriptionSchema).min(1),
  })
  .strict();

const groupBlockSchema = z
  .object({
    type: z.literal('group'),
    groupKind: z.enum(['superset', 'giant-set', 'circuit']),
    label: z.string().min(1),
    note: z.string().min(1).optional(),
    exercises: z.array(exerciseEntrySchema).min(1),
  })
  .strict();

const dtpExerciseSchema = z
  .object({
    name: z.string().min(1),
    warmup: z.array(setPrescriptionSchema).min(1).optional(),
    repWave: z.array(z.number().int().positive()),
    standardSets: z.array(setPrescriptionSchema).min(1).optional(),
  })
  .strict();

const dtpBlockSchema = z
  .object({
    type: z.literal('dtp'),
    variant: z.enum([
      'dtp-set',
      'dtp-superset',
      'half-dtp-set',
      'half-dtp-superset',
    ]),
    label: z.string().min(1),
    exercises: z.array(dtpExerciseSchema).min(1),
  })
  .strict();

const restBlockSchema = z
  .object({
    type: z.literal('rest'),
    mode: z.enum(['full-rest', 'active-recovery']),
    items: z.array(z.string().min(1)).min(1),
  })
  .strict();

const workoutBlockSchema = z.discriminatedUnion('type', [
  bookendBlockSchema,
  exerciseBlockSchema,
  groupBlockSchema,
  dtpBlockSchema,
  restBlockSchema,
]);

const phaseNumberSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const weeks = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/weeks' }),
  schema: z
    .object({
      id: z.string().regex(/^week-\d{2}$/),
      weekNumber: z.number().int().min(1).max(12),
      phaseNumber: phaseNumberSchema,
      phaseTitle: z.string().min(1),
      weekTheme: z.string().min(1),
      startDay: z.number().int().min(1).max(84),
      endDay: z.number().int().min(1).max(84),
      workoutDaysCount: z.number().int().min(1).max(7),
      restDaysCount: z.number().int().min(0).max(6),
      cardioSummary: z.string().min(1),
      twistsSummary: z.string().min(1),
      days: z
        .array(
          z
            .object({
              dayNumber: z.number().int().min(1).max(84),
              title: z.string().min(1),
              shortSplit: z.string().min(1),
              isRestDay: z.boolean(),
              restMode: z.enum(['full-rest', 'active-recovery']).optional(),
              hasDtp: z.boolean(),
            })
            .strict()
        )
        .length(7),
    })
    .strict(),
});

const days = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/days' }),
  schema: z
    .object({
      id: z.string().regex(/^day-\d{2}$/),
      dayNumber: z.number().int().min(1).max(84),
      weekNumber: z.number().int().min(1).max(12),
      phaseNumber: phaseNumberSchema,
      title: z.string().min(1),
      shortSplit: z.string().min(1),
      isRestDay: z.boolean(),
      restMode: z.enum(['full-rest', 'active-recovery']).optional(),
      primaryMuscles: z.array(muscleGroupSchema),
      secondaryMuscles: z.array(muscleGroupSchema),
      hasDtp: z.boolean(),
      hasSupersetOrGiant: z.boolean(),
      blocks: z.array(workoutBlockSchema).min(1),
    })
    .strict(),
});

export const collections = { weeks, days };
