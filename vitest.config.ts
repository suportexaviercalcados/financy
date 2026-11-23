import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode === 'test' ? 'test' : mode, process.cwd(), ''),
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
}))
