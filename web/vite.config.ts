import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    // Without this Vite silently moves to the next free port when 5173 is taken — which is
    // 5174, the API's port. It then wins the race, the server dies with EADDRINUSE, and the
    // dashboard loads fine but has nothing to talk to. Better to refuse to start.
    strictPort: true,
    proxy: { '/api': 'http://localhost:5174' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
