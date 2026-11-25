import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/engine/vortexmd.js'),
      name: 'VortexMD',
      formats: ['es', 'umd'],
      fileName: (format) => format === 'es' ? 'vortexmd-engine.js' : `vortexmd-engine.${format}.cjs`,
    },
    rollupOptions: {
      output: {
        exports: 'named',
      },
    },
    chunkSizeWarningLimit: 5000,
  },
  worker: {
    format: 'es',
    plugins: () => [],
  },
});
