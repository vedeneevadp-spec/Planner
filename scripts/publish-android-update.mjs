import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const origin = 'https://chaotika.ru'
const packageName = 'ru.chaotika.app'
const releaseCertificate =
  '2e1f24f672741d480091e6756bbb90666e5324eb1d1d8e529fae53007c13bb3d'
const maxBytes = 80 * 1024 * 1024
const publicDirectory = '/var/lib/planner/android-updates'

export function createUpdateManifest({
  badging,
  signature,
  bytes,
  sha256,
  notes,
}) {
  const pkg = badging.match(
    /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/,
  )
  assert.equal(pkg?.[1], packageName, 'Unexpected Android package')
  const versionCode = Number(pkg[2])
  const versionName = pkg[3]
  assert.ok(
    Number.isSafeInteger(versionCode) &&
      versionCode > 0 &&
      versionCode <= 2100000000,
  )
  assert.match(versionName, /^[0-9]+(\.[0-9]+){1,3}$/)
  const minSdk = Number(badging.match(/^sdkVersion:'(\d+)'/m)?.[1])
  assert.ok(
    Number.isInteger(minSdk) && minSdk >= 24 && minSdk <= 100,
    'Missing minSdk',
  )
  assert.ok(
    !/^application-debuggable/m.test(badging),
    'Debug APKs cannot be published',
  )
  const certificates = [
    ...signature.matchAll(/certificate SHA-256 digest: ([a-f0-9]+)/g),
  ].map((match) => match[1])
  assert.deepEqual(
    certificates,
    [releaseCertificate],
    'APK must use the existing Chaotika signing key',
  )
  const abis = [
    ...(badging.match(/^native-code: (.+)$/m)?.[1] ?? '').matchAll(
      /'([^']+)'/g,
    ),
  ].map((match) => match[1])
  // One public feed serves all installed APK variants; universal must include every supported architecture.
  assert.ok(
    abis.length === 1 && abis[0] === 'arm64-v8a',
    'This release feed currently accepts arm64 APKs only',
  )
  assert.ok(
    Number.isSafeInteger(bytes) && bytes > 0 && bytes <= maxBytes,
    'APK exceeds size budget',
  )
  assert.match(sha256, /^[a-f0-9]{64}$/)
  assert.ok(
    typeof notes === 'string' &&
      notes.trim().length > 0 &&
      notes.trim().length <= 2000,
    'Provide concise user-facing notes',
  )
  const filename = `Chaotika-${versionName}-build${versionCode}-arm64-v8a.apk`
  return {
    formatVersion: 1,
    packageName,
    versionCode,
    versionName,
    minSdk,
    abi: 'arm64-v8a',
    sizeBytes: bytes,
    sha256,
    notes: notes.trim(),
    url: `${origin}/android-updates/${filename}`,
  }
}

export function assertForwardUpdate(previous, next) {
  if (!previous) return
  assert.ok(
    Number.isSafeInteger(previous.versionCode),
    'Invalid existing release manifest',
  )
  assert.ok(
    next.versionCode >= previous.versionCode,
    'Refusing to publish an older version',
  )
  if (next.versionCode === previous.versionCode)
    assert.equal(
      next.sha256,
      previous.sha256,
      'A published build cannot be replaced with another APK',
    )
}

export function remotePublishScript(stage, expected) {
  assert.match(
    stage,
    /^\/opt\/planner\/shared\/android-update-staging\/[a-f0-9-]{36}$/,
  )
  assert.match(expected.sha256, /^[a-f0-9]{64}$/)
  const filename = new URL(expected.url).pathname.split('/').at(-1)
  assert.match(filename, /^Chaotika-[0-9.]+-build[0-9]+-arm64-v8a\.apk$/)
  return `
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,rename,chmod,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const stage=${JSON.stringify(stage)}, root=${JSON.stringify(publicDirectory)}, expected=${JSON.stringify(expected)}, filename=${JSON.stringify(filename)};
const hash=value=>createHash('sha256').update(value).digest('hex');
const manifest=JSON.parse(await readFile(stage+'/latest.json','utf8'));
assert.deepEqual(manifest,expected);
const bytes=await readFile(stage+'/'+filename);
assert.equal(bytes.length,expected.sizeBytes);assert.equal(hash(bytes),expected.sha256);
let previous=null;
try { previous=JSON.parse(await readFile(root+'/latest.json','utf8')); } catch(error) { if(error.code!=='ENOENT') throw error; }
(${assertForwardUpdate.toString()})(previous,expected);
await mkdir(root,{recursive:true,mode:0o755});
try { assert.equal(hash(await readFile(root+'/'+filename)),expected.sha256,'Immutable APK already differs'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
const temp='/var/lib/planner/.android-update-'+${JSON.stringify(stage.split('/').at(-1))};
await copyFile(stage+'/'+filename,temp+'.apk');await chmod(temp+'.apk',0o644);await rename(temp+'.apk',root+'/'+filename);
await writeFile(temp+'.json',JSON.stringify(expected,null,2)+'\\n',{mode:0o644});await rename(temp+'.json',root+'/latest.json');
await rm(stage,{recursive:true});
console.log(JSON.stringify({published:true,versionCode:expected.versionCode,url:expected.url}));
`
}

async function findBuildTools() {
  const sdk =
    process.env.ANDROID_HOME ??
    process.env.MOBILE_ANDROID_SDK ??
    path.join(os.homedir(), 'Library/Android/sdk')
  const directory = path.join(sdk, 'build-tools')
  const versions = (await readdir(directory))
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  assert.ok(versions[0], 'Android SDK build tools are required')
  return path.join(directory, versions[0])
}

async function main() {
  const args = process.argv.slice(2)
  const value = (name) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const apk =
    value('apk') ?? 'android/app/build/outputs/apk/release/app-release.apk'
  const notesFile = value('notes-file')
  assert.ok(
    notesFile,
    'Usage: npm run mobile:update:prepare -- --notes-file=<file> [--apk=<signed-apk>] [--output=<directory>] [--publish]',
  )
  for (const arg of args)
    assert.ok(
      arg === '--publish' || /^--(apk|notes-file|output|host)=/.test(arg),
      `Unknown option: ${arg}`,
    )
  const tools = await findBuildTools()
  const bytes = (await stat(apk)).size
  assert.ok(bytes > 0 && bytes <= maxBytes, 'APK exceeds size budget')
  const run = (tool, extra) =>
    execFileSync(path.join(tools, tool), extra, { encoding: 'utf8' })
  const manifest = createUpdateManifest({
    badging: run('aapt', ['dump', 'badging', apk]),
    signature: run('apksigner', ['verify', '--verbose', '--print-certs', apk]),
    bytes,
    sha256: createHash('sha256')
      .update(await readFile(apk))
      .digest('hex'),
    notes: await readFile(notesFile, 'utf8'),
  })
  run('zipalign', ['-c', '-P', '16', '4', apk])
  const output = path.resolve(value('output') ?? 'tmp/android-update')
  await mkdir(output, { recursive: true })
  const filename = new URL(manifest.url).pathname.split('/').at(-1)
  await copyFile(apk, path.join(output, filename))
  await writeFile(
    path.join(output, 'latest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  console.log(JSON.stringify({ prepared: true, output, manifest }))
  if (!args.includes('--publish')) return
  const host = value('host') ?? process.env.DEPLOY_HOST ?? 'root@147.45.158.186'
  assert.match(host, /^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/, 'Invalid SSH host')
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
  const stage = `/opt/planner/shared/android-update-staging/${randomUUID()}`
  execFileSync('ssh', [...sshArgs, host, `umask 077; mkdir -p ${stage}`], {
    stdio: 'inherit',
  })
  for (const name of [filename, 'latest.json'])
    execFileSync(
      'scp',
      [...sshArgs, path.join(output, name), `${host}:${stage}/${name}`],
      { stdio: 'inherit' },
    )
  const publish = spawnSync(
    'ssh',
    [
      ...sshArgs,
      host,
      'flock -n /var/lib/planner/.android-update-publish.lock node --input-type=module',
    ],
    {
      input: remotePublishScript(stage, manifest),
      encoding: 'utf8',
      timeout: 120000,
    },
  )
  assert.equal(publish.status, 0, publish.stderr || 'Remote publication failed')
  console.log(publish.stdout.trim())
  const response = await fetch(`${origin}/android-updates/latest.json`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  })
  assert.equal(
    response.status,
    200,
    'Published manifest is not publicly available',
  )
  assert.deepEqual(
    await response.json(),
    manifest,
    'Public manifest does not match the published release',
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
