import { defineConfig, sharpImageService } from 'astro/config';
import { pwaServiceWorker } from './scripts/pwa-sw-integration.ts';

export default defineConfig({
  output: 'static',
  integrations: [pwaServiceWorker()],
  build: {
    inlineStylesheets: 'auto',
  },
  image: {
    service: sharpImageService(),
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
