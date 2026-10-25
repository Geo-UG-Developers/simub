import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// En GitHub Pages la app vive en /simub/. Dos páginas: la app ciudadana y el panel de la estación.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/simub/',
  build: { rollupOptions: { input: { app: resolve(__dirname, 'index.html'), panel: resolve(__dirname, 'panel.html') } } },
});
