import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    },
  },
});
