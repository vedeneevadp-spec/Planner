import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import type { PluginOption } from 'vite'
import { defineConfig } from 'vitest/config'

const appRoot = fileURLToPath(new URL('.', import.meta.url))
const srcPath = fileURLToPath(new URL('./src', import.meta.url))
const contractsPath = fileURLToPath(
  new URL('../../packages/contracts/src', import.meta.url),
)
const shouldAnalyzeBundle = process.env.ANALYZE_BUNDLE === '1'

export default defineConfig({
  root: appRoot,
  plugins: [
    react(),
    ...(shouldAnalyzeBundle
      ? [
          visualizer({
            brotliSize: true,
            filename: path.resolve(appRoot, '../../tmp/web-bundle-stats.html'),
            gzipSize: true,
            template: 'treemap',
          }) as PluginOption,
        ]
      : []),
  ],
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              includeDependenciesRecursively: false,
              name: 'backup-contracts',
              priority: 100,
              test: (id) => id === path.join(contractsPath, 'backup.ts'),
            },
            {
              includeDependenciesRecursively: false,
              name: 'vendor-query',
              priority: 90,
              test: /node_modules[\/]@tanstack[\/]react-query[\/]/,
            },
            {
              includeDependenciesRecursively: false,
              name: 'vendor-router',
              priority: 90,
              test: /node_modules[\/]react-router[\/]/,
            },
            {
              includeDependenciesRecursively: false,
              name: 'vendor-react',
              priority: 90,
              test: /node_modules[\/](?:react|react-dom|scheduler)[\/]/,
            },
            {
              includeDependenciesRecursively: false,
              name: 'vendor-zod',
              priority: 90,
              test: /node_modules[\/]zod[\/]/,
            },
            {
              includeDependenciesRecursively: false,
              name: 'planner-contracts',
              priority: 50,
              test: (id) => id.startsWith(contractsPath),
            },
          ],
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
      reporter: ['text', 'html', 'json-summary'],
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
