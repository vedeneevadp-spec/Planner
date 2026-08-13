import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const apiRoot = path.join(repositoryRoot, 'apps/api')
const apiPackage = JSON.parse(
  await readFile(path.join(apiRoot, 'package.json'), 'utf8'),
)
const external = Object.keys(apiPackage.dependencies).filter(
  (name) => name !== '@planner/contracts',
)

await rm(path.join(apiRoot, 'dist'), { force: true, recursive: true })
const result = await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  entryPoints: {
    server: 'apps/api/src/server.ts',
    'task-reminders': 'apps/api/src/workers/task-reminders.ts',
    'user-backup-restore': 'apps/api/src/workers/user-backup-restore.ts',
  },
  external,
  format: 'esm',
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  minify: false,
  outdir: path.join(apiRoot, 'dist'),
  packages: 'bundle',
  platform: 'node',
  target: 'node24',
})

const forbiddenRuntimePackages = new Set([
  'esbuild',
  'tsx',
  'typescript',
  'vite',
])
const forbiddenInputs = Object.keys(result.metafile.inputs).filter((input) => {
  const marker = 'node_modules/'
  const markerIndex = input.lastIndexOf(marker)

  if (markerIndex < 0) {
    return false
  }

  const segments = input.slice(markerIndex + marker.length).split('/')
  const packageName = segments[0]?.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0]

  return packageName ? forbiddenRuntimePackages.has(packageName) : false
})

if (forbiddenInputs.length > 0) {
  throw new Error(
    `API production bundle includes forbidden dev tooling: ${forbiddenInputs.join(', ')}`,
  )
}
