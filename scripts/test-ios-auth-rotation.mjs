import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const directory = await mkdtemp(
  path.join(os.tmpdir(), 'planner-ios-auth-test-'),
)
try {
  await mkdir(path.join(directory, 'modules'))
  await copyFile(
    'tests/native/ios-auth-rotation.swift',
    path.join(directory, 'main.swift'),
  )
  const binary = path.join(directory, 'auth-rotation-test')
  execFileSync(
    'swiftc',
    [
      '-module-cache-path',
      path.join(directory, 'modules'),
      'ios/App/App/PlannerAuthSessionRotation.swift',
      path.join(directory, 'main.swift'),
      '-o',
      binary,
    ],
    { stdio: 'inherit' },
  )
  execFileSync(binary, [], { stdio: 'inherit' })
} finally {
  await rm(directory, { recursive: true, force: true })
}
