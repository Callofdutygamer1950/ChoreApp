import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps every path relative, so the built app works whether it is
// hosted at a domain root (Netlify) or in a sub-folder (GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
});
