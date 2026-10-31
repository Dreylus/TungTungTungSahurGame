import { defineConfig } from 'vite';

// `--mode android` writes the bundle straight into the Android app's assets.
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'android' ? 'android/app/src/main/assets/www' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    format: 'es',
  },
}));
