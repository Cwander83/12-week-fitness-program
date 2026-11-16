import { defineConfig, sharpImageService } from 'astro/config';

export default defineConfig({
  output: 'static',
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
