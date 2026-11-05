import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: 'forks',
  },
});
