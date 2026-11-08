import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// GitHub Pages project site: https://mlkdesign.github.io/kolaba/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/kolaba/' : '/',
  plugins: [preact()],
  build: { outDir: 'dist', assetsDir: 'app', emptyOutDir: true, target: 'es2020' },
  server: { port: 5173, host: '127.0.0.1' },
}));
