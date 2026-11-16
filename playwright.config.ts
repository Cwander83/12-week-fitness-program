import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const localChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasLocalChrome = existsSync(localChromePath);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    headless: true,
    trace: 'on-first-retry',
    ...(hasLocalChrome
      ? {
          launchOptions: {
            executablePath: localChromePath,
          },
        }
      : {}),
  },
});
