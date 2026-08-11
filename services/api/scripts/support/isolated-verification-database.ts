export interface VerificationDatabaseEnvironment {
  DATABASE_URL?: string
  NODE_ENV?: string
  VERIFICATION_DATABASE_TARGET?: string
}

const TEST_DATABASE_NAME_TOKEN = /(?:^|[._-])(ci|dev|test|verify)(?:$|[._-])/i

function fail(code: string, detail?: string): never {
  throw new Error(`${code}${detail ? `: ${detail}` : ''}`)
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
}

function assertTestDatabaseName(name: string): void {
  if (!TEST_DATABASE_NAME_TOKEN.test(name)) {
    fail(
      'VERIFICATION_DATABASE_NAME_UNSAFE',
      'database name/path must contain an explicit ci/dev/test/verify token',
    )
  }
}

/** Row-writing verification scripts must call this before constructing Prisma. */
export function assertIsolatedVerificationDatabase(
  env: VerificationDatabaseEnvironment = process.env,
): void {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN')
  }
  if (env.VERIFICATION_DATABASE_TARGET !== 'isolated') {
    fail('VERIFICATION_DATABASE_TARGET_REQUIRED', 'set VERIFICATION_DATABASE_TARGET=isolated')
  }

  const databaseUrl = env.DATABASE_URL?.trim()
  if (!databaseUrl) fail('VERIFICATION_DATABASE_URL_REQUIRED')

  if (databaseUrl.startsWith('file:')) {
    const sqliteTarget = databaseUrl.slice('file:'.length).split(/[?#]/, 1)[0] ?? ''
    if (sqliteTarget === ':memory:') return
    const sqliteName = sqliteTarget.split(/[\\/]/).at(-1) ?? ''
    assertTestDatabaseName(sqliteName)
    return
  }

  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    fail('VERIFICATION_DATABASE_URL_UNSAFE', 'only file:/postgres:/postgresql: are supported')
  }

  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    fail('VERIFICATION_DATABASE_URL_UNSAFE', 'invalid PostgreSQL URL')
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    fail('VERIFICATION_DATABASE_URL_UNSAFE', 'PostgreSQL verification must use a loopback host')
  }

  let databaseName: string
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    fail('VERIFICATION_DATABASE_URL_UNSAFE', 'invalid encoded PostgreSQL database name')
  }
  if (!databaseName || databaseName.includes('/')) {
    fail('VERIFICATION_DATABASE_URL_UNSAFE', 'PostgreSQL database name is required')
  }
  assertTestDatabaseName(databaseName)
}
