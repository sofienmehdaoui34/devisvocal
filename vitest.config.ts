import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // Résout les packages workspace vers leur source TS (pas besoin de build préalable).
    alias: {
      '@devisvocal/types': path.resolve(__dirname, 'packages/types/src/index.ts'),
      '@devisvocal/pdf': path.resolve(__dirname, 'packages/pdf/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
  },
});
