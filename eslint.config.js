import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map(
  (config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  }),
)
const layerOrder = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']
const publicApiModules = [
  'app',
  'pages/admin',
  'pages/calendar',
  'pages/cleaning',
  'pages/habits',
  'pages/more',
  'pages/profile',
  'pages/self-care',
  'pages/shopping',
  'pages/spheres',
  'pages/timeline',
  'pages/today',
  'pages/voice-assistant-settings',
  'widgets/sidebar',
  'features/cleaning',
  'features/emoji-library',
  'features/habits',
  'features/planner',
  'features/self-care',
  'features/session',
  'features/shopping-list',
  'features/task-create',
  'features/voice-assistant',
  'entities/emoji-set',
  'entities/habit',
  'entities/sphere',
  'entities/task',
  'entities/task-template',
  'shared/lib/api-client',
  'shared/lib/classnames',
  'shared/lib/date',
  'shared/lib/observability',
  'shared/lib/offline-sync',
  'shared/lib/theme',
  'shared/ui/Icon',
  'shared/ui/Page',
  'shared/ui/PageHeader',
  'shared/ui/SelectPicker',
]
const publicSliceModuleLayers = new Set([
  'entities',
  'features',
  'pages',
  'widgets',
])
const publicSliceModules = publicApiModules.filter((modulePath) => {
  const [layer, sliceName, extraSegment] = modulePath.split('/')

  return (
    layer && sliceName && !extraSegment && publicSliceModuleLayers.has(layer)
  )
})

function createPublicApiPatterns() {
  const publicApiPatterns = publicApiModules.flatMap((modulePath) => [
    {
      group: [`@/${modulePath}/*`],
      message: `Import from the public API "@/` + `${modulePath}" instead.`,
    },
    {
      regex: `^(?:\\.\\.?/)+(?:${modulePath})(?:/.+)$`,
      message: `Import from the public API "@/` + `${modulePath}" instead.`,
    },
  ])

  const siblingSlicePatterns = publicSliceModules.map((modulePath) => {
    const sliceName = modulePath.split('/')[1]

    return {
      regex: `^(?:\\.\\./)+(?:${escapeRegExp(sliceName)})(?:$|/.+)$`,
      message: `Import from the public API "@/` + `${modulePath}" instead.`,
    }
  })

  return [...publicApiPatterns, ...siblingSlicePatterns]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createLayerBoundaryPatterns(layer) {
  const layerIndex = layerOrder.indexOf(layer)
  const restrictedLayers = layerOrder.slice(0, layerIndex)
  const allowedLayers = layerOrder.slice(layerIndex)

  return restrictedLayers.flatMap((restrictedLayer) => [
    {
      group: [`@/${restrictedLayer}`, `@/${restrictedLayer}/*`],
      message: `"${layer}" can depend only on ${allowedLayers.join(', ')}.`,
    },
    {
      regex: `^(?:\\.\\.?/)+(?:${restrictedLayer})(?:/|$)`,
      message: `"${layer}" can depend only on ${allowedLayers.join(', ')}.`,
    },
  ])
}

const publicApiPatterns = createPublicApiPatterns()
const layerBoundaryConfigs = layerOrder.slice(1).map((layer) => ({
  files: [`apps/web/src/${layer}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [...publicApiPatterns, ...createLayerBoundaryPatterns(layer)],
      },
    ],
  },
}))

export default tseslint.config(
  {
    ignores: [
      'coverage',
      'dist',
      'playwright-report',
      'test-results',
      'node_modules',
      '.wakeword-venv',
      '**/.wakeword-venv/**',
      'tools/wakeword-training/output/**',
      'tools/wakeword-training/parity/input/**',
      'tools/wakeword-training/parity/expected/**',
      'android/**',
      'capacitor.config.ts',
      'ios/**',
      'apps/*/coverage',
      'apps/*/dist',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  ...typeCheckedConfigs,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
      'unused-imports/no-unused-imports': 'error',
    },
  },
  {
    files: ['apps/web/vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: publicApiPatterns,
        },
      ],
    },
  },
  ...layerBoundaryConfigs,
  prettierConfig,
)
