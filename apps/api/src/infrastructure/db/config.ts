export interface DatabaseConfig {
  connectionString: string
}

export function createDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  return {
    connectionString:
      env.DATABASE_URL ??
      'postgres://planner:planner@127.0.0.1:54329/planner_development',
  }
}
