export function createPgConnectionConfig(connectionString) {
  const config = {
    connectionString,
    keepAlive: true,
  }

  if (!connectionString.includes('pooler.supabase.com')) {
    return config
  }

  const url = new URL(connectionString)

  url.searchParams.delete('sslmode')
  url.searchParams.delete('uselibpqcompat')

  return {
    ...config,
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: false,
    },
  }
}
