import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  // `--mode replay` builds the static version for the jury (no backend): precomputed results (src/solver/replay.js)
  define: mode === 'replay' ? { 'import.meta.env.VITE_REPLAY': '"1"' } : {},
  base: './', // relative paths: works when opening the file and on GitHub Pages
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'esnext', // Ensures support for modern features
    assetsInlineLimit: 100000000, // Forces everything to be inline (CSS, images, JS)
    chunkSizeWarningLimit: 100000000, // Avoids size warnings
    cssCodeSplit: false, // Puts all the CSS in a single place
    brotliSize: false,
    rollupOptions: {
      inlineDynamicImports: true, // Ensures there are no external imports
      output: {
        manualChunks: undefined, // Avoids splitting into chunks
      },
    },
  },
}));