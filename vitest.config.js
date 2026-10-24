import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite's own config resolution reads .env from envDir before vitest's test.env
  // below ever applies — pointing it at a directory with no .env file avoids that
  // read entirely (the real .env is root-owned 600 in production; tests don't need
  // it, everything they need is injected via test.env).
  envDir: './tests',
  test: {
    setupFiles: ['./tests/setup.js'],
    pool: 'forks',
    testTimeout: 30000,
    env: {
      JWT_SECRET: 'test-secret-buttercloud-vitest',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PASSWORD_HASH_ROUNDS: '1',
      API_KEY_HASH_ROUNDS: '1',
      NODE_CREDENTIALS_KEY: '0'.repeat(63) + '1', // any 32-byte hex key works for tests
    },
  },
});
