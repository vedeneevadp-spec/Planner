import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const roots = ['apps', 'packages']

const ignoredPathParts = new Set(['.git', 'coverage', 'dist', 'node_modules'])

const ignoredFilePatterns = [
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
]

const allowedPrefixes = [
  'apps/web/src/shared/time/',
  'packages/contracts/src/time/',
]

const checkedExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

const forbiddenPatterns = [
  {
    name: 'toISOString().slice(0, 10)',
    regex: /toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/g,
  },
  {
    name: 'new Date(...T00:00...)',
    regex:
      /new\s+Date\s*\(\s*(?:`[^`]*T00:00[^`]*`|["'][^"']*T00:00[^"']*["'])/g,
  },
  {
    name: 'new Date(...T12:00...)',
    regex:
      /new\s+Date\s*\(\s*(?:`[^`]*T12:00[^`]*`|["'][^"']*T12:00[^"']*["'])/g,
  },
  {
    name: 'local getFullYear/getMonth/getDate',
    regex: /\.(?:getFullYear|getMonth|getDate)\s*\(/g,
  },
]

const violations = []

for (const scanRoot of roots) {
  await scanDirectory(path.join(root, scanRoot))
}

if (violations.length > 0) {
  console.error('Time System guard failed.')
  console.error(
    'Planner-date logic must use shared/time helpers instead of raw Date date-only operations.',
  )

  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column} ${violation.name}: ${violation.match}`,
    )
  }

  process.exitCode = 1
}

async function scanDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    if (ignoredPathParts.has(entry.name)) {
      continue
    }

    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      await scanDirectory(fullPath)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    await scanFile(fullPath)
  }
}

async function scanFile(filePath) {
  const relativePath = path.relative(root, filePath).replaceAll(path.sep, '/')

  if (allowedPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return
  }

  if (ignoredFilePatterns.some((pattern) => pattern.test(relativePath))) {
    return
  }

  if (!checkedExtensions.has(path.extname(relativePath))) {
    return
  }

  const fileStat = await stat(filePath)

  if (fileStat.size === 0) {
    return
  }

  const source = await readFile(filePath, 'utf8')

  for (const pattern of forbiddenPatterns) {
    pattern.regex.lastIndex = 0

    for (const match of source.matchAll(pattern.regex)) {
      const position = getLineColumn(source, match.index ?? 0)

      violations.push({
        column: position.column,
        file: relativePath,
        line: position.line,
        match: match[0],
        name: pattern.name,
      })
    }
  }
}

function getLineColumn(source, index) {
  let line = 1
  let column = 1

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  return { column, line }
}
