import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages: https://mlkdesign.github.io/kolaba/admin/ — built into ../admin (repo root, branch main, folder /).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/kolaba/admin/' : '/',
  plugins: [react()],
  build: { outDir: '../admin', assetsDir: 'assets', emptyOutDir: true, target: 'es2020' },
  server: { port: 5174, host: '127.0.0.1', strictPort: true },
}));
