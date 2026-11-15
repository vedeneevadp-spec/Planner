import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const pgTools = new Set(['pg_dump', 'pg_restore', 'createdb', 'dropdb', 'psql'])

// libpq reads the password from a private file; command arguments never contain it.
export async function withPgToolCredentials(command, args, env, run) {
  if (!pgTools.has(path.basename(command))) return run(args, env)
  const entries = []
  const safeArgs = args.map((argument) => {
    const prefix = argument.match(/^(--(?:dbname|maintenance-db)=)/)?.[1] ?? ''
    const value = argument.slice(prefix.length)
    if (!/^postgres(?:ql)?:\/\//.test(value)) {
      if (/(?:^|\s)password\s*=/.test(value)) {
        throw new Error(
          'PostgreSQL tool connections must use a URL, with credentials moved to a password file.',
        )
      }
      return argument
    }
    const url = new URL(value)
    const password =
      url.searchParams.get('password') ??
      (decodeURIComponent(url.password) || env.PGPASSWORD)
    if (password) {
      entries.push(
        [
          url.searchParams.get('host') ??
            (url.hostname.replace(/^\[|\]$/g, '') || 'localhost'),
          url.searchParams.get('port') ?? (url.port || '5432'),
          url.searchParams.get('dbname') ??
            (decodeURIComponent(url.pathname.slice(1)) || '*'),
          url.searchParams.get('user') ??
            (decodeURIComponent(url.username) || '*'),
          password,
        ]
          .map(escapePasswordField)
          .join(':'),
      )
    }
    url.password = ''
    url.searchParams.delete('password')
    return `${prefix}${url.toString()}`
  })
  if (!entries.length) return run(safeArgs, env)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'planner-pgpass-'))
  try {
    const passfile = path.join(directory, 'pgpass')
    await writeFile(passfile, `${entries.join('\n')}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    const safeEnv = { ...env, PGPASSFILE: passfile }
    delete safeEnv.PGPASSWORD
    return await run(safeArgs, safeEnv)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function escapePasswordField(value) {
  if (/[\r\n\0]/.test(value))
    throw new Error(
      'Invalid control character in PostgreSQL connection settings.',
    )
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:')
}
