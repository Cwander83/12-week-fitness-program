import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startStaticServer, type StaticTestServer } from './server';

let server: StaticTestServer;

const OVERFLOW_ROUTES = [
  '/',
  '/week/1',
  '/week/4',
  '/week/10',
  '/day/1',
  '/day/6',
  '/day/8',
  '/day/25',
  '/day/54',
  '/day/69',
  '/day/80',
  '/day/84',
];

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, hasTouch: true, isMobile: true },
  { name: '390x844', width: 390, height: 844, hasTouch: true, isMobile: true },
  { name: '1280x800', width: 1280, height: 800, hasTouch: false, isMobile: false },
] as const;

interface Telemetry {
  consoleErrors: string[];
  pageErrors: string[];
  cspViolations: Array<{
    violatedDirective: string;
    effectiveDirective: string;
    blockedURI: string;
  }>;
  requestFailures: string[];
}

async function attachTelemetry(page: Page): Promise<Telemetry> {
  const telemetry: Telemetry = {
    consoleErrors: [],
    pageErrors: [],
    cspViolations: [],
    requestFailures: [],
  };

  await page.addInitScript(() => {
    const win = window as unknown as {
      __cspViolations?: Array<{
        violatedDirective: string;
        effectiveDirective: string;
        blockedURI: string;
      }>;
    };
    win.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      win.__cspViolations?.push({
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      telemetry.consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    telemetry.pageErrors.push(err.message);
  });

  page.on('requestfailed', (req) => {
    telemetry.requestFailures.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`);
  });

  return telemetry;
}

async function assertCleanTelemetry(page: Page, telemetry: Telemetry): Promise<void> {
  const violations = await page.evaluate(() => {
    const win = window as unknown as {
      __cspViolations?: Array<{
        violatedDirective: string;
        effectiveDirective: string;
        blockedURI: string;
      }>;
    };
    return win.__cspViolations ?? [];
  });
  telemetry.cspViolations.push(...violations);

  expect(telemetry.consoleErrors, 'Expected zero console errors').toEqual([]);
  expect(telemetry.pageErrors, 'Expected zero uncaught page errors').toEqual([]);
  expect(telemetry.cspViolations, 'Expected zero CSP / Trusted Types violations').toEqual([]);
  expect(telemetry.requestFailures, 'Expected zero failed subresource requests').toEqual([]);
}

test.beforeAll(async () => {
  server = await startStaticServer();
});

test.afterAll(async () => {
  await server.close();
});

test.describe('HTTP security headers & strict CSP serving', () => {
  test('serves exact vercel.ts security headers and immutable /_astro cache headers', async ({ page }) => {
    const telemetry = await attachTelemetry(page);
    const response = await page.goto(`${server.baseUrl}/`);
    expect(response?.status()).toBe(200);

    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("require-trusted-types-for 'script'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');

    const assetResponses: Array<{ url: string; cacheControl: string | undefined }> = [];
    page.on('response', (res) => {
      if (new URL(res.url()).pathname.startsWith('/_astro/')) {
        assetResponses.push({
          url: res.url(),
          cacheControl: res.headers()['cache-control'],
        });
      }
    });

    await page.reload({ waitUntil: 'networkidle' });
    expect(assetResponses.length).toBeGreaterThan(0);
    for (const asset of assetResponses) {
      expect(asset.cacheControl).toBe('public, max-age=31536000, immutable');
    }

    await assertCleanTelemetry(page, telemetry);
  });
});

test.describe('Responsive layout overflow across 320px, 390px, and 1280px', () => {
  for (const vp of VIEWPORTS) {
    test(`zero horizontal overflow across sampled routes at ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
        isMobile: vp.isMobile,
      });
      const page = await context.newPage();
      const telemetry = await attachTelemetry(page);

      for (const route of OVERFLOW_ROUTES) {
        const res = await page.goto(`${server.baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
        expect(res?.status(), `Route ${route} should return 200`).toBe(200);

        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          metrics.scrollWidth,
          `Overflow detected on ${route} at ${vp.name}: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
        ).toBeLessThanOrEqual(metrics.innerWidth);
      }

      await assertCleanTelemetry(page, telemetry);
      await context.close();
    });
  }
});

test.describe('Coarse-pointer touch target dimensions (>= 44x44 CSS px)', () => {
  test('interactive controls on / and /day/54 meet >= 44x44 under coarse pointer', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    const telemetry = await attachTelemetry(page);

    for (const route of ['/', '/day/54']) {
      await page.goto(`${server.baseUrl}${route}`, { waitUntil: 'networkidle' });

      const undersized = await page.evaluate(() => {
        const failures: Array<{ tag: string; text: string; width: number; height: number; selector: string }> = [];
        const controls = document.querySelectorAll<HTMLElement>(
          'header button, header a, main button, main a, main summary, footer button, footer a',
        );
        for (const el of controls) {
          if (el.closest('[hidden]') || el.classList.contains('visually-hidden')) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.width < 43.9 || rect.height < 43.9) {
            failures.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 60),
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
              selector: el.className || el.id || el.tagName.toLowerCase(),
            });
          }
        }
        return failures;
      });

      expect(
        undersized,
        `Coarse-pointer controls under 44x44 on ${route}: ${JSON.stringify(undersized)}`,
      ).toEqual([]);
    }

    // Also inspect controls inside open <dialog id="quick-switcher">
    await page.locator('footer [data-switcher-open]').click();
    await expect(page.locator('#quick-switcher')).toHaveAttribute('open', '');

    const dialogUndersized = await page.evaluate(() => {
      const failures: Array<{ tag: string; text: string; width: number; height: number; selector: string }> = [];
      const controls = document.querySelectorAll<HTMLElement>('#quick-switcher button, #quick-switcher a');
      for (const el of controls) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.width < 43.9 || rect.height < 43.9) {
          failures.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 60),
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            selector: el.className || el.id || el.tagName.toLowerCase(),
          });
        }
      }
      return failures;
    });

    expect(
      dialogUndersized,
      `Quick-Switcher controls under 44x44: ${JSON.stringify(dialogUndersized)}`,
    ).toEqual([]);

    await assertCleanTelemetry(page, telemetry);
    await context.close();
  });
});

test.describe('WCAG 2.1 AA accessibility scan via @axe-core/playwright', () => {
  for (const route of ['/', '/week/4', '/day/6', '/day/54']) {
    for (const mode of ['light', 'dark'] as const) {
      test(`${route} passes Axe WCAG 2.1 AA in ${mode} mode`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          colorScheme: 'light',
        });
        const page = await context.newPage();
        const telemetry = await attachTelemetry(page);

        await page.goto(`${server.baseUrl}${route}`, { waitUntil: 'networkidle' });

        if (mode === 'dark') {
          await page.locator('[data-theme-toggle]').click();
          await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
        }

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        expect(results.violations, `Axe violations on ${route} (${mode})`).toEqual([]);

        if (route === '/day/54') {
          await page.locator('footer [data-switcher-open]').click();
          const dialog = page.locator('#quick-switcher');
          await expect(dialog).toHaveAttribute('open', '');
          await expect(dialog).toHaveCSS('opacity', '1');
          const dialogResults = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          expect(
            dialogResults.violations,
            `Axe violations with Quick-Switcher open on ${route} (${mode})`,
          ).toEqual([]);
        }

        await assertCleanTelemetry(page, telemetry);
        await context.close();
      });
    }
  }
});

test.describe('Whole-Day Completion, Continuation, Quick-Switcher, ?p= Backup, & Reset', () => {
  test('full end-to-end persistence and continuation flow', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const telemetry = await attachTelemetry(page);

    // 1. Visit /day/1 and click Complete Day 1
    await page.goto(`${server.baseUrl}/day/1`, { waitUntil: 'networkidle' });
    const completeBtn = page.locator('button[data-complete-day="1"]');
    await expect(completeBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(completeBtn).toHaveAccessibleName('Complete Day 1');
    await expect(page.locator('[data-up-next-link]')).toBeHidden();

    await completeBtn.click();
    await expect(completeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(completeBtn).toHaveAccessibleName('Complete Day 1');
    await expect(page.locator('[data-complete-status]')).toContainText('1 / 84 Complete');
    await expect(page.locator('[data-up-next-link]')).toBeVisible();
    await expect(page.locator('[data-up-next-link]')).toContainText('Up Next: Day 2');

    // 2. Navigate to / — confirm zero redirect, Hero CTA upgraded, Matrix states updated
    await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname).toBe('/');

    const heroCta = page.locator('[data-hero-cta]');
    await expect(heroCta).toContainText('Continue Day 2 — Chest / Triceps');
    await expect(heroCta).toHaveAttribute('href', '/day/2');
    await expect(page.locator('main [data-progress-summary]')).toContainText('1 / 84');
    await expect(page.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '1');

    await expect(page.locator('main [data-day-cell="1"]')).toHaveAttribute('data-state', 'completed');
    await expect(page.locator('main [data-day-cell="2"]')).toHaveAttribute('data-state', 'next');

    // 3. Open Quick-Switcher <dialog>
    const switcherTrigger = page.locator('footer [data-switcher-open]');
    await switcherTrigger.click();
    const dialog = page.locator('#quick-switcher');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog.locator('[data-progress-summary]')).toContainText('1 / 84');
    await expect(dialog.locator('[data-day-cell="1"]')).toHaveAttribute('data-state', 'completed');
    await expect(dialog.locator('[data-day-cell="2"]')).toHaveAttribute('data-state', 'next');
    await expect(dialog.locator('[data-switcher-jump-next]')).toHaveAttribute('href', '/day/2');

    // 4. Copy ?p= backup link and test restore in a completely fresh browser context
    await dialog.locator('[data-copy-backup]').click();
    await expect(dialog.locator('[data-copy-backup-label]')).toHaveText('Copied!');
    const backupUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(backupUrl).toMatch(/\?p=[A-Za-z0-9_-]{15}$/);

    const freshContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const freshPage = await freshContext.newPage();
    const freshTelemetry = await attachTelemetry(freshPage);

    await freshPage.goto(backupUrl, { waitUntil: 'networkidle' });
    expect(new URL(freshPage.url()).search).toBe('');
    await expect(freshPage.locator('[data-hero-cta]')).toContainText('Continue Day 2 — Chest / Triceps');
    await expect(freshPage.locator('main [data-progress-summary]')).toContainText('1 / 84');
    const restoredStorage = await freshPage.evaluate(() => localStorage.getItem('trainer_completed_v1'));
    expect(restoredStorage).toBe('[1]');

    await assertCleanTelemetry(freshPage, freshTelemetry);
    await freshContext.close();

    // 5. Two-tap Reset Progress inside Quick-Switcher
    const resetBtn = dialog.locator('[data-reset-progress]');
    await resetBtn.click();
    await expect(resetBtn).toHaveAttribute('data-armed', 'true');
    await expect(dialog.locator('[data-reset-label]')).toHaveText('Confirm Clear');
    expect(await page.evaluate(() => localStorage.getItem('trainer_completed_v1'))).toBe('[1]');

    await resetBtn.click();
    await expect(resetBtn).not.toHaveAttribute('data-armed', 'true');
    await expect(dialog.locator('[data-reset-label]')).toHaveText('Reset');
    await expect(dialog.locator('[data-progress-summary]')).toContainText('0 / 84');
    await expect(heroCta).toContainText('Start Day 1 — Legs');
    expect(await page.evaluate(() => localStorage.getItem('trainer_completed_v1'))).toBeNull();

    // 6. Escape closes Quick-Switcher dialog cleanly
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');

    await assertCleanTelemetry(page, telemetry);
    await context.close();
  });
});

test.describe('Dark Mode toggle persistence & OS reset', () => {
  test('toggles meta color-scheme, persists across reload, and clears localStorage on OS match', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'light',
    });
    const page = await context.newPage();
    const telemetry = await attachTelemetry(page);

    await page.goto(`${server.baseUrl}/day/54`, { waitUntil: 'networkidle' });
    const meta = page.locator('meta[name="color-scheme"]');
    await expect(meta).toHaveAttribute('content', 'light dark');
    expect(await page.evaluate(() => localStorage.getItem('color-scheme'))).toBeNull();

    const toggleBtn = page.locator('[data-theme-toggle]');
    await toggleBtn.click();
    await expect(meta).toHaveAttribute('content', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('color-scheme'))).toBe('dark');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(meta).toHaveAttribute('content', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('color-scheme'))).toBe('dark');

    await toggleBtn.click();
    await expect(meta).toHaveAttribute('content', 'light dark');
    expect(await page.evaluate(() => localStorage.getItem('color-scheme'))).toBeNull();

    await assertCleanTelemetry(page, telemetry);
    await context.close();
  });
});

test.describe('prefers-reduced-motion: reduce', () => {
  test('keeps all content visible at opacity: 1 with animations disabled', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const telemetry = await attachTelemetry(page);

    for (const route of ['/', '/day/54']) {
      await page.goto(`${server.baseUrl}${route}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      const hiddenElements = await page.evaluate(() => {
        const targets = document.querySelectorAll<HTMLElement>(
          '.reveal-on-scroll, .dtp-bar, .phase-row, .ex-card, .dtp-panel',
        );
        const broken: Array<{ className: string; opacity: string; animationName: string }> = [];
        for (const el of targets) {
          const style = window.getComputedStyle(el);
          if (parseFloat(style.opacity) < 0.99 || style.animationName !== 'none') {
            broken.push({
              className: el.className,
              opacity: style.opacity,
              animationName: style.animationName,
            });
          }
        }
        return broken;
      });

      expect(hiddenElements, `Reduced motion check failed on ${route}`).toEqual([]);
    }

    await assertCleanTelemetry(page, telemetry);
    await context.close();
  });
});
