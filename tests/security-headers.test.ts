import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../vercel';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function getHeaderMap(source: string): Map<string, string> {
  const rule = config.headers?.find((entry) => entry.source === source);
  expect(rule, `Missing header rule for ${source}`).toBeDefined();
  return new Map(rule!.headers.map((h) => [h.key, h.value]));
}

describe('vercel.ts security & cache headers', () => {
  it('configures immutable cache headers on /_astro/(.*)', () => {
    const astroHeaders = getHeaderMap('/_astro/(.*)');
    expect(astroHeaders.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
  });

  it('configures revalidating PWA headers on /sw.js and /manifest.webmanifest', () => {
    const swHeaders = getHeaderMap('/sw.js');
    expect(swHeaders.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(swHeaders.get('Cache-Control')?.toLowerCase()).not.toContain('no-store');
    expect(swHeaders.get('Service-Worker-Allowed')).toBe('/');

    const manifestHeaders = getHeaderMap('/manifest.webmanifest');
    expect(manifestHeaders.get('Content-Type')).toBe('application/manifest+json; charset=utf-8');
    expect(manifestHeaders.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(manifestHeaders.get('Cache-Control')?.toLowerCase()).not.toContain('no-store');
  });

  it('sets bfcache-friendly global security headers without no-store', () => {
    const rootHeaders = getHeaderMap('/(.*)');

    expect(rootHeaders.get('X-Frame-Options')).toBe('DENY');
    expect(rootHeaders.get('X-Content-Type-Options')).toBe('nosniff');
    expect(rootHeaders.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin'
    );
    expect(rootHeaders.get('Permissions-Policy')).toContain('camera=()');
    expect(rootHeaders.get('Permissions-Policy')).toContain('geolocation=()');
    expect(rootHeaders.get('Permissions-Policy')).toContain('microphone=()');
    expect(rootHeaders.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(rootHeaders.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(rootHeaders.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains'
    );

    const cacheControl = rootHeaders.get('Cache-Control') ?? '';
    expect(cacheControl.toLowerCase()).not.toContain('no-store');
  });

  it('enforces strict CSP directives including Trusted Types and no unsafe script directives', () => {
    const rootHeaders = getHeaderMap('/(.*)');
    const csp = rootHeaders.get('Content-Security-Policy') ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'report-sample'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain('trusted-types pwa-sw');
    expect(csp).toContain('upgrade-insecure-requests');

    const scriptSrc =
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain("script-src 'self'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('matches the exact SHA-256 hash of BaseLayout.astro inline FOUC script', () => {
    const baseLayoutPath = path.join(ROOT_DIR, 'src/layouts/BaseLayout.astro');
    const source = readFileSync(baseLayoutPath, 'utf8');

    const inlineScripts = [
      ...source.matchAll(/<script\s+is:inline>([\s\S]*?)<\/script>/g),
    ].map((match) => match[1]);

    expect(inlineScripts).toHaveLength(1);

    const scriptBody = inlineScripts[0];
    expect(scriptBody.trim()).toBe(scriptBody);
    expect(scriptBody).not.toContain('\n');

    const digest = createHash('sha256').update(scriptBody, 'utf8').digest('base64');
    const expectedHashToken = `sha256-${digest}`;

    const rootHeaders = getHeaderMap('/(.*)');
    const csp = rootHeaders.get('Content-Security-Policy') ?? '';
    expect(csp).toContain(`'${expectedHashToken}'`);
  });
});

describe('vercel.ts git deployment policy', () => {
  it('restricts automatic git deployments strictly to main', () => {
    expect(config.git?.deploymentEnabled).toEqual({
      '*': false,
      '**': false,
      develop: false,
      main: true,
    });
  });
});
