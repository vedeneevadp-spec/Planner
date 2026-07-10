import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const caddyfile = await readFile(
  new URL('../deploy/caddy/Caddyfile', import.meta.url),
  'utf8',
)

const permissionsPolicy = caddyfile.match(/Permissions-Policy\s+"([^"]+)"/)?.[1]

assert.ok(permissionsPolicy, 'Caddyfile must define Permissions-Policy.')
assert.match(
  permissionsPolicy,
  /(?:^|,\s*)microphone=\(self\)(?:,|$)/,
  'Production web voice requires microphone access for the current origin.',
)
assert.match(
  permissionsPolicy,
  /(?:^|,\s*)camera=\(\)(?:,|$)/,
  'Camera access must remain disabled.',
)
assert.match(
  permissionsPolicy,
  /(?:^|,\s*)geolocation=\(\)(?:,|$)/,
  'Geolocation access must remain disabled.',
)

console.log('Production configuration check passed.')
