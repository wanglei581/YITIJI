import helmet from 'helmet'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { startVerificationApi } from './verification-api-server'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { PrismaService } from '../../src/prisma/prisma.service'

/** Test-only allowlist: never inherit provider, webhook, storage or production credentials. */
export function isolateFirstOrderEnvironment(directory: string): () => void {
  const saved = { ...process.env }
  const keep = new Set(['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR'])
  for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key]
  Object.assign(process.env, {
    NODE_ENV: 'test', DOTENV_CONFIG_PATH: join(directory, 'no-dotenv'),
    FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_DIR: join(directory, 'storage'),
    SMS_PROVIDER: 'log', AI_PROVIDER: 'mock', ADMIN_LOGIN_SECOND_FACTOR: 'off',
    TERMINAL_ADMIN_SECRET: randomBytes(32).toString('hex'),
    TERMINAL_ACTION_TOKEN_SECRET: randomBytes(32).toString('hex'),
  })
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

export async function startFirstOrderFullApplication() {
  return startVerificationApi(0, process.env.REDIS_URL, {
    queues: true,
    configure(app) {
      app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
      app.enableCors({ origin: /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, credentials: true })
    },
  })
}

/** Random private credentials for existing password login, not SMS/2FA acceptance. */
export async function seedFirstOrderLogin(prisma: PrismaService, users: { admin: string; partner: string }) {
  const password = `Fo!${randomBytes(24).toString('base64url')}9a`
  const passwordHash = await bcrypt.hash(password, 12)
  for (const [index, id] of Object.values(users).entries()) {
    const phone = `1380000000${index}`
    await prisma.user.update({ where: { id }, data: {
      passwordHash, phoneEnc: encryptPhone(phone), phoneHash: hashPhone(phone), phoneVerifiedAt: new Date(),
    } })
  }
  return { admin: { loginId: users.admin, password }, partner: { loginId: users.partner, password } }
}
