# 12-Week Hardcore Daily Trainer

Mobile-first static Astro 5 training guide covering all 12 weeks and 84 daily sessions of the 12-Week Hardcore Daily Trainer. Built for static hosting on Vercel with zero-database `localStorage` day completion tracking, shareable 84-bit `?p=` backup links, inline anatomical muscle maps, and proportional DTP rep pyramids.

## Prerequisites

- Node.js 24 LTS or newer
- `pnpm` 10+

## Setup

```bash
pnpm install
```

## Development & Build

- `pnpm run compile:workouts` — Parse `src/data/raw/12-week-program.md` into `src/content/weeks/*.json` and `src/content/days/*.json`.
- `pnpm dev` — Start the local Astro dev server.
- `pnpm astro check` — Run TypeScript and Astro diagnostics.
- `pnpm build` — Build all 97 static routes (`/`, `/week/1`–`/week/12`, `/day/1`–`/day/84`) into `dist/`.
- `pnpm preview` — Preview the production `dist/` output locally.

## Testing

- `pnpm test` — Run Vitest unit suites (workout data compiler integrity, progress store, and security headers).
- `pnpm test:e2e` — Run Playwright end-to-end, accessibility, and strict CSP checks against the built site.
