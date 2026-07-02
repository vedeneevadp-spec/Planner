import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

export async function runAndCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      process.stderr.write(chunk)
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(output)
        return
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}.`,
        ),
      )
    })
  })
}

export async function writeCoverageLog(logPath, output) {
  await mkdir(path.dirname(logPath), { recursive: true })
  await writeFile(logPath, output)
}

export function assertCoverageHotspots(output, hotspots) {
  const normalizedOutput = stripAnsi(output)

  for (const hotspot of hotspots) {
    const linePct = readLineCoverage(normalizedOutput, hotspot.file)

    assert.ok(
      linePct !== null,
      `API coverage hotspot is missing from report: ${hotspot.file}`,
    )
    assert.ok(
      linePct >= hotspot.minLines,
      [
        `API coverage hotspot ${hotspot.file} lines is ${linePct}%.`,
        `Expected at least ${hotspot.minLines}%.`,
        'Add focused tests or update this guard with an explicit rationale.',
      ].join(' '),
    )
  }
}

function readLineCoverage(output, fileName) {
  const pattern = new RegExp(
    `(?:^|\\n).*${escapeRegExp(fileName)}\\s*\\|\\s*([\\d.]+)\\s*\\|`,
  )
  const match = output.match(pattern)

  return match?.[1] ? Number(match[1]) : null
}

function stripAnsi(value) {
  const escapeCharacter = String.fromCharCode(27)
  const ansiEscapePattern = new RegExp(`${escapeCharacter}\\[[0-9;]*m`, 'g')

  return value.replace(ansiEscapePattern, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
