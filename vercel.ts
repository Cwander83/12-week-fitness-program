import { routes } from '@vercel/config/v1';
import type { VercelConfig } from '@vercel/config/v1';

const FOUC_SCRIPT_SHA256 = 'sha256-eX5ERvR2a2ScrV1g0G4detpKkdT7dJT5TrhEpZs6bwo=';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' '${FOUC_SCRIPT_SHA256}' 'report-sample'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  'upgrade-insecure-requests',
].join('; ');

export const config: VercelConfig = {
  framework: 'astro',
  cleanUrls: true,
  headers: [
    routes.header('/(.*)', [
      { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value:
          'camera=(), geolocation=(), microphone=(), payment=(), usb=(), focus-without-user-activation=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      },
    ]),
    routes.header('/_astro/(.*)', [
      {
        key: 'Cache-Control',
        value: 'public, max-age=31536000, immutable',
      },
    ]),
  ],
};
