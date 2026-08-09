export interface RecruitmentContentVerifyEnvironment {
  DATABASE_URL?: string
  NODE_ENV?: string
  RECRUITMENT_CONTENT_VERIFY_TARGET?: string
}

const LOCAL_POSTGRES_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 防止会写 fixture 的 HTTP verifier 误连生产或远程 PostgreSQL。 */
export function assertRecruitmentContentVerifyTarget(
  env: RecruitmentContentVerifyEnvironment = process.env,
): void {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('RECRUITMENT_CONTENT_VERIFY_PRODUCTION_FORBIDDEN')
  }
  if (env.RECRUITMENT_CONTENT_VERIFY_TARGET !== 'isolated') {
    throw new Error('RECRUITMENT_CONTENT_VERIFY_TARGET_REQUIRED')
  }
  const databaseUrl = env.DATABASE_URL?.trim()
  if (!databaseUrl || !isLocalDatabase(databaseUrl)) {
    throw new Error('RECRUITMENT_CONTENT_VERIFY_DATABASE_UNSAFE')
  }
}

function isLocalDatabase(databaseUrl: string): boolean {
  if (databaseUrl.startsWith('file:')) return true
  try {
    const parsed = new URL(databaseUrl)
    return (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:')
      && LOCAL_POSTGRES_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}
