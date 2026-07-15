export type InternalAuthVerifyEnvironment = {
  DATABASE_URL?: string
  INTERNAL_AUTH_VERIFY_TARGET?: string
  NODE_ENV?: string
}

const LOCAL_POSTGRES_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function isLocalVerifyDatabase(databaseUrl: string): boolean {
  if (databaseUrl.startsWith('file:')) return true

  try {
    const parsed = new URL(databaseUrl)
    return (
      (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      LOCAL_POSTGRES_HOSTS.has(parsed.hostname)
    )
  } catch {
    return false
  }
}

/**
 * `verify:internal-auth-phone` creates temporary users and organizations. It must
 * only ever write to an explicitly marked, local isolated database.
 */
export function assertInternalAuthVerifyTarget(env: InternalAuthVerifyEnvironment = process.env): void {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('INTERNAL_AUTH_VERIFY_PRODUCTION_FORBIDDEN: production is never a verify target')
  }

  if (env.INTERNAL_AUTH_VERIFY_TARGET !== 'isolated') {
    throw new Error('INTERNAL_AUTH_VERIFY_TARGET_REQUIRED: set INTERNAL_AUTH_VERIFY_TARGET=isolated')
  }

  const databaseUrl = env.DATABASE_URL?.trim()
  if (!databaseUrl || !isLocalVerifyDatabase(databaseUrl)) {
    throw new Error('INTERNAL_AUTH_VERIFY_DATABASE_UNSAFE: only local SQLite or localhost PostgreSQL is allowed')
  }
}
