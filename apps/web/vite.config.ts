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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@tanstack/react-query/')) {
            return 'vendor-query'
          }

          if (
            id.includes('/node_modules/react-router/') ||
            id.includes('/node_modules/react-router-dom/')
          ) {
            return 'vendor-router'
          }

          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }

          if (id.includes('/node_modules/zod/')) {
            return 'vendor-zod'
          }

          if (id.startsWith(contractsPath)) {
            return 'planner-contracts'
          }
        },
      },
    },
  },
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
      thresholds: {
        branches: 61,
        functions: 66,
        lines: 65.5,
        statements: 65.5,
      },
    },
  },
})
