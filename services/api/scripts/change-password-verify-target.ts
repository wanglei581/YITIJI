export const CHANGE_PASSWORD_VERIFY_DATABASE_URL = 'file:./prisma/verify-change-password.db'

export type ChangePasswordVerifyEnvironment = {
  DATABASE_URL?: string
  NODE_ENV?: string
  VERIFY_CHANGE_PASSWORD_DB_PATH?: string
}

export function assertChangePasswordVerifyTarget(
  env: ChangePasswordVerifyEnvironment,
  expectedDatabasePath: string,
): void {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('CHANGE_PASSWORD_VERIFY_PRODUCTION_FORBIDDEN: production is never a verify target')
  }

  if (env.DATABASE_URL !== CHANGE_PASSWORD_VERIFY_DATABASE_URL) {
    throw new Error('CHANGE_PASSWORD_VERIFY_DATABASE_UNSAFE: only the dedicated local SQLite database is allowed')
  }

  if (env.VERIFY_CHANGE_PASSWORD_DB_PATH !== expectedDatabasePath) {
    throw new Error('CHANGE_PASSWORD_VERIFY_DATABASE_PATH_REQUIRED: dedicated database path marker is required')
  }
}
