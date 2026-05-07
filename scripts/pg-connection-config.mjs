export function createPgConnectionConfig(connectionString) {
  const config = {
    connectionString,
    connectionTimeoutMillis: readPositiveIntegerEnv(
      'PG_CONNECTION_TIMEOUT_MS',
      10_000,
    ),
    keepAlive: true,
    query_timeout: readPositiveIntegerEnv('PG_QUERY_TIMEOUT_MS', 30_000),
  }

  return config
}

export async function preparePgAdminConnection(client) {
  await client.query('reset role')
  await client.query("select set_config('request.jwt.claims', '{}', false)")
  await client.query("set lock_timeout = '10s'")
}

export async function closePgClient(client) {
  let timeout

  try {
    await Promise.race([
      client.end(),
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 1000)
      }),
    ])
  } catch {
    // Ignore close errors; query errors are handled at the call site.
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }

    client.connection?.stream?.destroy?.()
  }
}

function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name]

  if (!rawValue) {
    return fallback
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${rawValue}`)
  }

  return value
}
