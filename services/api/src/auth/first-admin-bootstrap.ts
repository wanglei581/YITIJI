import { closeSync, fsyncSync, openSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import * as bcrypt from 'bcryptjs'
import type { PrismaService } from '../prisma/prisma.service'
import { dbKindOf } from '../prisma/create-client'
import { PASSWORD_PROOF_STATE } from './password-proof-state'

export const FIRST_ADMIN_BOOTSTRAP_CONFIRMATION = 'CREATE_FIRST_PRODUCTION_ADMIN'
export const FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION = 'auth.first_admin_bootstrap.created'
export const FIRST_ADMIN_BOOTSTRAP_WINDOW_MS = 10 * 60 * 1000

export interface FirstAdminBootstrapConfig {
  username: string
  name: string
  credentialsPath: string
}

export function readFirstAdminBootstrapConfig(
  env: NodeJS.ProcessEnv,
  now = new Date(),
): FirstAdminBootstrapConfig {
  if (env.NODE_ENV !== 'production') {
    throw new Error('FIRST_ADMIN_BOOTSTRAP_ENV_FORBIDDEN: NODE_ENV must be production')
  }
  const databaseUrl = required(env, 'DATABASE_URL')
  if (dbKindOf(databaseUrl) !== 'postgres') {
    throw new Error('FIRST_ADMIN_BOOTSTRAP_POSTGRES_REQUIRED')
  }
  if (required(env, 'FIRST_ADMIN_BOOTSTRAP_CONFIRM') !== FIRST_ADMIN_BOOTSTRAP_CONFIRMATION) {
    throw new Error(`FIRST_ADMIN_BOOTSTRAP_CONFIRMATION_REQUIRED: expected ${FIRST_ADMIN_BOOTSTRAP_CONFIRMATION}`)
  }

  const authorizedUntil = new Date(required(env, 'FIRST_ADMIN_BOOTSTRAP_AUTHORIZED_UNTIL'))
  const remainingMs = authorizedUntil.getTime() - now.getTime()
  if (!Number.isFinite(authorizedUntil.getTime()) || remainingMs <= 0 || remainingMs > FIRST_ADMIN_BOOTSTRAP_WINDOW_MS) {
    throw new Error('FIRST_ADMIN_BOOTSTRAP_WINDOW_INVALID: authorization window must expire within 10 minutes')
  }

  const username = required(env, 'FIRST_ADMIN_USERNAME')
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,31}$/.test(username)) {
    throw new Error('FIRST_ADMIN_USERNAME_INVALID')
  }
  const name = required(env, 'FIRST_ADMIN_NAME')
  if (Array.from(name).length > 64) throw new Error('FIRST_ADMIN_NAME_INVALID')

  const credentialsPath = assertSecureCredentialsPath(required(env, 'FIRST_ADMIN_CREDENTIALS_OUT'))
  return { username, name, credentialsPath }
}

export function createTemporaryAdminPassword(): string {
  return `${randomBytes(24).toString('base64url')}aA1!`
}

export function writeCredentialsFile(
  path: string,
  credentials: { username: string; temporaryPassword: string },
): void {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8' })
    fsyncSync(fd)
    const mode = statSync(path).mode & 0o777
    if (mode !== 0o600) throw new Error(`FIRST_ADMIN_CREDENTIALS_MODE_INVALID: received ${mode.toString(8)}`)
    syncDirectory(dirname(path))
  } catch (error) {
    closeSync(fd)
    unlinkSync(path)
    throw error
  }
  closeSync(fd)
}

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export async function createFirstAdmin(
  prisma: PrismaService,
  input: { username: string; name: string; passwordHash: string },
): Promise<{ id: string; username: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (await tx.user.count() !== 0) throw new Error('FIRST_ADMIN_BOOTSTRAP_NOT_EMPTY')
      const user = await tx.user.create({
        data: {
          username: input.username,
          name: input.name,
          passwordHash: input.passwordHash,
          passwordProofState: PASSWORD_PROOF_STATE.TEMPORARY,
          role: 'admin',
          orgId: null,
          enabled: true,
        },
        select: { id: true, username: true },
      })
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'system-bootstrap',
          action: FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION,
          targetType: 'auth',
          targetId: user.id,
          payloadJson: JSON.stringify({ username: user.username, passwordProofState: PASSWORD_PROOF_STATE.TEMPORARY }),
        },
      })
      return user
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (isSerializationConflict(error)) throw new Error('FIRST_ADMIN_BOOTSTRAP_CONFLICT')
    throw error
  }
}

export async function hashTemporaryAdminPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

function assertSecureCredentialsPath(path: string): string {
  if (!isAbsolute(path)) throw new Error('FIRST_ADMIN_CREDENTIALS_PATH_MUST_BE_ABSOLUTE')
  const parent = realpathSync(dirname(path))
  const stats = statSync(parent)
  if (!stats.isDirectory()) throw new Error('FIRST_ADMIN_CREDENTIALS_PARENT_INVALID')
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error('FIRST_ADMIN_CREDENTIALS_PARENT_OWNER_INVALID')
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error('FIRST_ADMIN_CREDENTIALS_PARENT_PERMISSIONS_INVALID: parent must not allow group/other access')
  }
  const resolved = resolve(parent, basename(path))
  if (dirname(resolved) !== parent) throw new Error('FIRST_ADMIN_CREDENTIALS_PATH_INVALID')
  return resolved
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}

function isSerializationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  return candidate.code === 'P2034' || (typeof candidate.message === 'string' && candidate.message.includes('40001'))
}
