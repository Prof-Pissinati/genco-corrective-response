import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  // `--mode replay` gera a versão estática para o júri (sem backend): resultados pré-calculados (src/solver/replay.js)
  define: mode === 'replay' ? { 'import.meta.env.VITE_REPLAY': '"1"' } : {},
  base: './', // caminhos relativos: funciona abrindo o arquivo e no GitHub Pages
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'esnext', // Garante suporte a recursos modernos
    assetsInlineLimit: 100000000, // Força tudo a ser inline (CSS, Imagens, JS)
    chunkSizeWarningLimit: 100000000, // Evita avisos de tamanho
    cssCodeSplit: false, // Junta todo o CSS num lugar só
    brotliSize: false,
    rollupOptions: {
      inlineDynamicImports: true, // Garante que não haja imports externos
      output: {
        manualChunks: undefined, // Evita separar em pedaços
      },
    },
  },
}));