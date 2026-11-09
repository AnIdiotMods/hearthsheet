import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri sets TAURI_DEV_HOST when a phone or emulator loads the dev server over the network.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5183 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: ['es2021', 'chrome100', 'safari15'] },
  test: { include: ['tests/**/*.test.ts'] },
});
