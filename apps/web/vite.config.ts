import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const appRoot = fileURLToPath(new URL('.', import.meta.url))
const srcPath = fileURLToPath(new URL('./src', import.meta.url))
const contractsPath = fileURLToPath(
  new URL('../../packages/contracts/src', import.meta.url),
)

export default defineConfig({
  root: appRoot,
  plugins: [react()],
  server: {
    open: process.env.VITE_OPEN_BROWSER !== 'false',
  },
  resolve: {
    alias: {
      '@': path.resolve(srcPath),
      '@planner/contracts': path.resolve(contractsPath),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
})
