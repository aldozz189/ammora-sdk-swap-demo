import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works under any path (GitHub Pages project site).
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
