import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  // @pintoria/shared is a CommonJS workspace package — without this Vite serves
  // its raw CJS to the browser in dev (blank page: "exports is not defined").
  optimizeDeps: {
    include: ['@pintoria/shared'],
  },
  build: {
    outDir: 'dist',
    // workspace-linked packages live outside node_modules, so teach the CJS
    // interop to also transform @pintoria/shared's dist output.
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared/],
      transformMixedEsModules: true,
    },
  },
});
