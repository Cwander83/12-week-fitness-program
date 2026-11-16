import {
  STORAGE_KEY,
  TOTAL_DAYS,
  buildBackupUrl,
  clearCompletedDays,
  computeNextDay,
  countWeekCompleted,
  decodeProgressToken,
  readCompletedDays,
  toggleDayInList,
  writeCompletedDays,
} from './progress-store';

interface DayManifestEntry {
  title: string;
  weekNumber: number;
}

type DayManifest = Record<string, DayManifestEntry>;

interface ViewTransitionLike {
  types?: Set<string>;
}

interface PageRevealEventLike extends Event {
  viewTransition?: ViewTransitionLike | null;
}

interface NavigationLike {
  activation?: {
    from?: { url?: string | null } | null;
    entry?: { url?: string | null } | null;
  } | null;
}

const COLOR_SCHEME_KEY = 'color-scheme';

function getColorSchemeMeta(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
}

function prefersDarkMedia(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function resolveCurrentTheme(meta: HTMLMetaElement | null): 'light' | 'dark' {
  const content = meta?.getAttribute('content') ?? 'light dark';
  if (content === 'dark') return 'dark';
  if (content === 'light') return 'light';
  return prefersDarkMedia().matches ? 'dark' : 'light';
}

function syncThemeToggleUI(): void {
  const meta = getColorSchemeMeta();
  const resolved = resolveCurrentTheme(meta);
  const schemeContent = meta?.getAttribute('content') ?? 'light dark';
  document.documentElement.setAttribute('data-resolved-theme', resolved);

  for (const btn of document.querySelectorAll<HTMLElement>('[data-theme-toggle]')) {
    btn.setAttribute('data-resolved-theme', resolved);
    btn.setAttribute('data-scheme', schemeContent);
    const label = btn.querySelector<HTMLElement>('[data-theme-label]');
    if (label) {
      label.textContent = resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    }
  }
}

function toggleColorScheme(): void {
  const meta = getColorSchemeMeta();
  if (!meta) return;

  const currentlyDark = resolveCurrentTheme(meta) === 'dark';
  const target: 'light' | 'dark' = currentlyDark ? 'light' : 'dark';
  const osScheme: 'light' | 'dark' = prefersDarkMedia().matches ? 'dark' : 'light';

  if (target === osScheme) {
    meta.setAttribute('content', 'light dark');
    try {
      window.localStorage.removeItem(COLOR_SCHEME_KEY);
    } catch {
      // Ignore storage failures cleanly.
    }
  } else {
    meta.setAttribute('content', target);
    try {
      window.localStorage.setItem(COLOR_SCHEME_KEY, target);
    } catch {
      // Ignore storage failures cleanly.
    }
  }
  syncThemeToggleUI();
}

function readManifest(): DayManifest {
  const el = document.getElementById('program-day-manifest');
  if (!el?.textContent) return {};
  try {
    return JSON.parse(el.textContent) as DayManifest;
  } catch {
    return {};
  }
}

function canTransitionDisplay(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('transition-behavior: allow-discrete')
  );
}

function hasNonZeroTransition(el: HTMLElement): boolean {
  const durations = window.getComputedStyle(el).transitionDuration.split(',');
  return durations.some((d) => parseFloat(d) > 0);
}

function setupDirectionalViewTransitions(): void {
  window.addEventListener('pagereveal', (event: Event) => {
    const reveal = event as PageRevealEventLike;
    const vt = reveal.viewTransition;
    if (!vt?.types) return;

    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    const fromUrlStr = nav?.activation?.from?.url;
    const toUrlStr = nav?.activation?.entry?.url ?? window.location.href;
    if (!fromUrlStr || !toUrlStr) return;

    try {
      const fromPath = new URL(fromUrlStr, window.location.origin).pathname;
      const toPath = new URL(toUrlStr, window.location.origin).pathname;

      const dayFrom = fromPath.match(/\/day\/(\d+)/);
      const dayTo = toPath.match(/\/day\/(\d+)/);
      if (dayFrom && dayTo) {
        const a = Number(dayFrom[1]);
        const b = Number(dayTo[1]);
        if (a !== b) {
          vt.types.add(b > a ? 'next' : 'previous');
        }
        return;
      }

      const weekFrom = fromPath.match(/\/week\/(\d+)/);
      const weekTo = toPath.match(/\/week\/(\d+)/);
      if (weekFrom && weekTo) {
        const a = Number(weekFrom[1]);
        const b = Number(weekTo[1]);
        if (a !== b) {
          vt.types.add(b > a ? 'next' : 'previous');
        }
      }
    } catch {
      // Ignore malformed URL transitions cleanly.
    }
  });
}

function initApp(): void {
  syncThemeToggleUI();
  setupDirectionalViewTransitions();

  // Import ?p= backup token if present and clean URL without reload.
  try {
    const currentUrl = new URL(window.location.href);
    const token = currentUrl.searchParams.get('p');
    if (token !== null) {
      const imported = decodeProgressToken(token);
      if (imported !== null) {
        writeCompletedDays(imported, window.localStorage);
        currentUrl.searchParams.delete('p');
        const nextUrl = currentUrl.pathname + currentUrl.search + currentUrl.hash;
        window.history.replaceState(window.history.state, '', nextUrl);
      }
    }
  } catch {
    // Ignore URL/storage edge cases cleanly.
  }

  const manifest = readManifest();
  let completedDays = readCompletedDays(window.localStorage);

  const setActiveWeekPill = (weekNum: number): void => {
    for (const pill of document.querySelectorAll<HTMLElement>('[data-switcher-week]')) {
      if (Number(pill.getAttribute('data-switcher-week')) === weekNum) {
        pill.setAttribute('data-active', 'true');
      } else {
        pill.removeAttribute('data-active');
      }
    }
  };

  const hydrateProgressUI = (days: number[]): void => {
    completedDays = days;
    const count = days.length;
    const pct = Math.round((count / TOTAL_DAYS) * 100);
    const doneSet = new Set(days);
    const nextDay = computeNextDay(days);
    const nextMeta = nextDay !== null ? manifest[String(nextDay)] : undefined;

    for (const cta of document.querySelectorAll<HTMLAnchorElement>('[data-hero-cta]')) {
      if (!cta.dataset.defaultHref) {
        cta.dataset.defaultHref = cta.getAttribute('href') ?? '/day/1';
      }
      const labelEl = cta.querySelector<HTMLElement>('[data-hero-cta-label]') ?? cta;
      if (!cta.dataset.defaultLabel) {
        cta.dataset.defaultLabel = labelEl.textContent?.trim() ?? 'Start Day 1 — Legs';
      }

      if (count >= TOTAL_DAYS) {
        labelEl.textContent = 'Program Complete (84/84) — Review Day 1';
        cta.setAttribute('href', '/day/1');
      } else if (count > 0 && nextDay !== null) {
        labelEl.textContent = nextMeta
          ? `Continue Day ${nextDay} — ${nextMeta.title}`
          : `Continue Day ${nextDay}`;
        cta.setAttribute('href', `/day/${nextDay}`);
      } else {
        labelEl.textContent = cta.dataset.defaultLabel;
        cta.setAttribute('href', cta.dataset.defaultHref);
      }
    }

    for (const el of document.querySelectorAll<HTMLElement>('[data-progress-summary]')) {
      const compact = el.dataset.format === 'compact' || el.closest('#quick-switcher') !== null;
      el.textContent = compact
        ? `${count} / ${TOTAL_DAYS} Completed`
        : `${count} / ${TOTAL_DAYS} Days Complete · ${pct}%`;
    }

    for (const el of document.querySelectorAll<HTMLElement>('[data-progress-next]')) {
      if (nextDay !== null && nextMeta) {
        el.textContent = `Next: Week ${nextMeta.weekNumber} · Day ${nextDay}`;
      } else if (nextDay !== null) {
        el.textContent = `Next: Day ${nextDay}`;
      } else {
        el.textContent = 'All 84 Days Complete';
      }
    }

    for (const el of document.querySelectorAll<HTMLElement>('[data-progress-bar]')) {
      el.style.width = `${pct}%`;
      const bar =
        el.getAttribute('role') === 'progressbar' ? el : el.closest<HTMLElement>('[role="progressbar"]');
      bar?.setAttribute('aria-valuenow', String(count));
    }

    for (const el of document.querySelectorAll<HTMLElement>('[data-week-progress]')) {
      const weekNum = Number(el.getAttribute('data-week-progress'));
      if (weekNum >= 1 && weekNum <= 12) {
        const weekDone = countWeekCompleted(days, weekNum);
        el.textContent =
          el.dataset.format === 'short' ? `${weekDone}/7` : `${weekDone} / 7 Completed`;
      }
    }

    for (const el of document.querySelectorAll<HTMLElement>('[data-day-cell]')) {
      const dayNum = Number(el.getAttribute('data-day-cell'));
      const state = doneSet.has(dayNum)
        ? 'completed'
        : nextDay !== null && dayNum === nextDay
          ? 'next'
          : 'pending';
      el.setAttribute('data-state', state);
    }

    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-complete-day]')) {
      const dayNum = Number(btn.getAttribute('data-complete-day'));
      const isDone = doneSet.has(dayNum);
      btn.setAttribute('aria-pressed', String(isDone));

      const group = btn.closest('[data-complete-group]') ?? document;
      const statusEl = group.querySelector<HTMLElement>('[data-complete-status]');
      if (statusEl) {
        statusEl.textContent = isDone
          ? `Saved · ${count} / ${TOTAL_DAYS} Complete`
          : `${count} / ${TOTAL_DAYS} Complete`;
      }

      const upNext = group.querySelector<HTMLElement>('[data-up-next-link]');
      if (upNext) {
        upNext.hidden = !isDone;
        if (isDone) {
          upNext.removeAttribute('hidden');
        } else {
          upNext.setAttribute('hidden', '');
        }
      }
    }

    for (const el of document.querySelectorAll<HTMLElement>('[data-thumb-label]')) {
      if (!el.dataset.defaultLabel) {
        el.dataset.defaultLabel = el.textContent?.trim() ?? '';
      }
      const dayToggle = document.querySelector<HTMLElement>('[data-complete-day]');
      const activeDayNum = dayToggle ? Number(dayToggle.getAttribute('data-complete-day')) : null;
      if (activeDayNum !== null) {
        el.textContent = doneSet.has(activeDayNum)
          ? `${el.dataset.defaultLabel} · Done`
          : el.dataset.defaultLabel;
      } else if (count > 0 && nextDay !== null) {
        el.textContent = `Next: Day ${nextDay} (${count}/${TOTAL_DAYS}) — Switch`;
      } else {
        el.textContent = el.dataset.defaultLabel;
      }
    }

    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-switcher-jump-next]')) {
      const target = nextDay ?? 1;
      link.setAttribute('href', `/day/${target}`);
      const labelEl = link.querySelector<HTMLElement>('[data-jump-next-label]') ?? link;
      labelEl.textContent = nextDay !== null ? `Jump to Day ${nextDay}` : 'Review Day 1';
    }
  };

  hydrateProgressUI(completedDays);

  // Theme toggle handlers & OS/storage/bfcache sync.
  for (const btn of document.querySelectorAll<HTMLElement>('[data-theme-toggle]')) {
    btn.addEventListener('click', toggleColorScheme);
  }

  prefersDarkMedia().addEventListener('change', syncThemeToggleUI);

  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === COLOR_SCHEME_KEY) {
      const meta = getColorSchemeMeta();
      const val = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'light dark';
      meta?.setAttribute('content', val);
      syncThemeToggleUI();
    } else if (e.key === STORAGE_KEY || e.key === null) {
      hydrateProgressUI(readCompletedDays(window.localStorage));
    }
  });

  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if (e.persisted) {
      syncThemeToggleUI();
      hydrateProgressUI(readCompletedDays(window.localStorage));
    }
  });

  // Whole-day completion toggle handlers.
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-complete-day]')) {
    btn.addEventListener('click', () => {
      const dayNum = Number(btn.getAttribute('data-complete-day'));
      if (dayNum >= 1 && dayNum <= TOTAL_DAYS) {
        const nextDays = toggleDayInList(completedDays, dayNum);
        writeCompletedDays(nextDays, window.localStorage);
        hydrateProgressUI(nextDays);
      }
    });
  }

  // Copy portable ?p= backup URL.
  let copyTimer: number | undefined;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy-backup]')) {
    const labelEl = btn.querySelector<HTMLElement>('[data-copy-backup-label]') ?? btn;
    if (!btn.dataset.defaultLabel) {
      btn.dataset.defaultLabel = labelEl.textContent?.trim() ?? 'Copy Backup Link';
    }
    btn.addEventListener('click', () => {
      const url = buildBackupUrl(window.location.href, completedDays);
      window.navigator.clipboard?.writeText(url)?.catch(() => {});
      labelEl.textContent = 'Copied!';
      btn.setAttribute('data-copied', 'true');
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        labelEl.textContent = btn.dataset.defaultLabel ?? 'Copy Backup Link';
        btn.removeAttribute('data-copied');
      }, 2400);
    });
  }

  // Two-tap Reset Progress.
  let resetTimer: number | undefined;
  const disarmReset = (btn: HTMLButtonElement, labelEl: HTMLElement): void => {
    btn.removeAttribute('data-armed');
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline');
    labelEl.textContent = btn.dataset.defaultLabel ?? 'Reset';
  };

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-reset-progress]')) {
    const labelEl = btn.querySelector<HTMLElement>('[data-reset-label]') ?? btn;
    if (!btn.dataset.defaultLabel) {
      btn.dataset.defaultLabel = labelEl.textContent?.trim() ?? 'Reset';
    }
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-armed') !== 'true') {
        btn.setAttribute('data-armed', 'true');
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary');
        labelEl.textContent = 'Confirm Clear';
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => disarmReset(btn, labelEl), 4500);
      } else {
        window.clearTimeout(resetTimer);
        disarmReset(btn, labelEl);
        clearCompletedDays(window.localStorage);
        hydrateProgressUI([]);
      }
    });
  }

  // Top-layer Quick-Switcher <dialog id="quick-switcher">.
  const dialog = document.getElementById('quick-switcher') as HTMLDialogElement | null;
  if (dialog) {
    let lastTrigger: HTMLElement | null = null;
    let closeFallbackTimer: number | undefined;

    const finishClose = (): void => {
      window.clearTimeout(closeFallbackTimer);
      dialog.removeAttribute('data-closing');
      if (dialog.open) {
        dialog.close();
      }
    };

    const closeDialog = (): void => {
      if (!dialog.open) return;
      if (!prefersReducedMotion() && canTransitionDisplay() && hasNonZeroTransition(dialog)) {
        dialog.setAttribute('data-closing', 'true');
        const onEnd = (ev: TransitionEvent): void => {
          if (ev.target !== dialog) return;
          dialog.removeEventListener('transitionend', onEnd);
          finishClose();
        };
        dialog.addEventListener('transitionend', onEnd);
        window.clearTimeout(closeFallbackTimer);
        closeFallbackTimer = window.setTimeout(() => {
          dialog.removeEventListener('transitionend', onEnd);
          finishClose();
        }, 280);
      } else {
        finishClose();
      }
    };

    const openDialog = (trigger: HTMLElement | null): void => {
      lastTrigger = trigger;
      window.clearTimeout(closeFallbackTimer);
      dialog.removeAttribute('data-closing');
      if (!dialog.open) {
        dialog.showModal();
      }
      const nextDay = computeNextDay(completedDays) ?? 1;
      const nextWeek = Math.ceil(nextDay / 7);
      setActiveWeekPill(nextWeek);
      const targetRow =
        dialog.querySelector<HTMLElement>(`[data-week-row="${nextWeek}"]`) ??
        dialog.querySelector<HTMLElement>(`#qs-week-${nextWeek}`) ??
        dialog.querySelector<HTMLElement>(`[data-day-cell="${nextDay}"]`);
      targetRow?.scrollIntoView({ block: 'start' });
    };

    for (const openBtn of document.querySelectorAll<HTMLElement>('[data-switcher-open]')) {
      openBtn.addEventListener('click', () => openDialog(openBtn));
    }

    dialog.addEventListener('click', (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (target === dialog || target?.closest('[data-switcher-close]')) {
        closeDialog();
        return;
      }
      const weekBtn = target?.closest<HTMLElement>('[data-switcher-week]');
      if (weekBtn) {
        const weekNum = Number(weekBtn.getAttribute('data-switcher-week'));
        if (weekNum >= 1 && weekNum <= 12) {
          setActiveWeekPill(weekNum);
        }
        const row =
          dialog.querySelector<HTMLElement>(`[data-week-row="${weekNum}"]`) ??
          dialog.querySelector<HTMLElement>(`#qs-week-${weekNum}`);
        row?.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        });
      }
    });

    dialog.addEventListener('cancel', (ev: Event) => {
      if (!prefersReducedMotion() && canTransitionDisplay() && hasNonZeroTransition(dialog)) {
        ev.preventDefault();
        closeDialog();
      }
    });

    dialog.addEventListener('close', () => {
      window.clearTimeout(closeFallbackTimer);
      dialog.removeAttribute('data-closing');
      if (lastTrigger?.isConnected) {
        lastTrigger.focus();
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
