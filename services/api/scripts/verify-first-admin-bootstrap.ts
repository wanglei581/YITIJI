import assert from 'node:assert/strict'
import * as bcrypt from 'bcryptjs'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION,
  FIRST_ADMIN_BOOTSTRAP_CONFIRMATION,
  createFirstAdmin,
  createTemporaryAdminPassword,
  readFirstAdminBootstrapConfig,
  writeCredentialsFile,
} from '../src/auth/first-admin-bootstrap'
import type { PrismaService } from '../src/prisma/prisma.service'
import { AuthService } from '../src/auth/auth.service'

let passed = 0
function pass(label: string): void {
  passed += 1
  console.log(`  PASS ${label}`)
}

async function expectRejected(run: () => unknown | Promise<unknown>, code: string, label: string): Promise<void> {
  await assert.rejects(async () => run(), (error: unknown) => error instanceof Error && error.message.includes(code))
  pass(label)
}

async function main(): Promise<void> {
  console.log('\n=== first admin bootstrap verification ===')
  const root = mkdtempSync(join(tmpdir(), 'first-admin-bootstrap-'))
  chmodSync(root, 0o700)
  try {
    const now = new Date('2026-08-06T10:00:00.000Z')
    const validEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://operator:secret@127.0.0.1:5432/production',
      FIRST_ADMIN_BOOTSTRAP_CONFIRM: FIRST_ADMIN_BOOTSTRAP_CONFIRMATION,
      FIRST_ADMIN_BOOTSTRAP_AUTHORIZED_UNTIL: '2026-08-06T10:05:00.000Z',
      FIRST_ADMIN_USERNAME: 'root.admin',
      FIRST_ADMIN_NAME: '首个管理员',
      FIRST_ADMIN_CREDENTIALS_OUT: join(root, 'credentials.json'),
    }
    const config = readFirstAdminBootstrapConfig(validEnv, now)
    assert.equal(config.username, 'root.admin')
    pass('production + PostgreSQL + 10分钟内执行窗口放行')

    await expectRejected(() => readFirstAdminBootstrapConfig({ ...validEnv, NODE_ENV: 'test' }, now), 'ENV_FORBIDDEN', '非生产拒绝')
    await expectRejected(() => readFirstAdminBootstrapConfig({ ...validEnv, DATABASE_URL: 'file:./dev.db' }, now), 'POSTGRES_REQUIRED', 'SQLite拒绝')
    await expectRejected(() => readFirstAdminBootstrapConfig({ ...validEnv, FIRST_ADMIN_BOOTSTRAP_CONFIRM: 'true' }, now), 'CONFIRMATION_REQUIRED', '非精确确认短语拒绝')
    await expectRejected(() => readFirstAdminBootstrapConfig({ ...validEnv, FIRST_ADMIN_BOOTSTRAP_AUTHORIZED_UNTIL: '2026-08-06T10:11:00.000Z' }, now), 'WINDOW_INVALID', '超过10分钟窗口拒绝')
    await expectRejected(() => readFirstAdminBootstrapConfig({ ...validEnv, FIRST_ADMIN_CREDENTIALS_OUT: 'relative.json' }, now), 'PATH_MUST_BE_ABSOLUTE', '相对凭据路径拒绝')

    const linkedParent = join(tmpdir(), `first-admin-bootstrap-parent-${process.pid}`)
    symlinkSync(root, linkedParent)
    try {
      const linkedConfig = readFirstAdminBootstrapConfig({
        ...validEnv,
        FIRST_ADMIN_CREDENTIALS_OUT: join(linkedParent, 'linked-credentials.json'),
      }, now)
      assert.equal(linkedConfig.credentialsPath, join(realpathSync(root), 'linked-credentials.json'))
    } finally {
      rmSync(linkedParent, { force: true })
    }
    pass('凭据路径固定到已校验的canonical父目录')

    const insecureParent = join(root, 'insecure')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(insecureParent, { mode: 0o755 })
    chmodSync(insecureParent, 0o755)
    await expectRejected(
      () => readFirstAdminBootstrapConfig({ ...validEnv, FIRST_ADMIN_CREDENTIALS_OUT: join(insecureParent, 'credentials.json') }, now),
      'PARENT_PERMISSIONS_INVALID',
      '组或其他用户可访问的父目录拒绝',
    )

    const password = createTemporaryAdminPassword()
    assert.ok(password.length >= 36)
    assert.match(password, /[a-z]/)
    assert.match(password, /[A-Z]/)
    assert.match(password, /\d/)
    assert.match(password, /[^A-Za-z0-9]/)
    writeCredentialsFile(config.credentialsPath, { username: config.username, temporaryPassword: password })
    assert.equal(statSync(config.credentialsPath).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(readFileSync(config.credentialsPath, 'utf8')), {
      username: config.username,
      temporaryPassword: password,
    })
    await expectRejected(
      () => writeCredentialsFile(config.credentialsPath, { username: config.username, temporaryPassword: 'replacement' }),
      'EEXIST',
      '已存在的凭据文件拒绝覆盖',
    )
    pass('强随机初始密码只写O_EXCL 0600文件')

    const createdUsers: Array<Record<string, unknown>> = []
    const audits: Array<Record<string, unknown>> = []
    let transactionIsolation: unknown
    const fakePrisma = {
      $transaction: async (operation: (tx: unknown) => Promise<unknown>, options: { isolationLevel?: unknown }) => {
        transactionIsolation = options.isolationLevel
        return operation({
          user: {
            count: async () => createdUsers.length,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              const user = { id: 'first-admin-id', username: data.username, ...data }
              createdUsers.push(user)
              return { id: user.id, username: user.username }
            },
          },
          auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return { id: 'audit-id' } } },
        })
      },
    } as unknown as PrismaService
    const created = await createFirstAdmin(fakePrisma, { username: config.username, name: config.name, passwordHash: 'hash' })
    assert.equal(created.id, 'first-admin-id')
    assert.equal(transactionIsolation, 'Serializable')
    assert.equal(createdUsers.length, 1)
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.action, FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION)
    assert.equal(audits[0]?.actorId, null)
    assert.ok(!JSON.stringify(audits).includes(password))
    pass('User创建与无秘密必成功审计处于Serializable事务')
    await expectRejected(
      () => createFirstAdmin(fakePrisma, { username: 'second.admin', name: '第二管理员', passwordHash: 'hash2' }),
      'NOT_EMPTY',
      '已有User时稳定拒绝且不创建第二管理员',
    )

    const authSource = readFileSync(resolve(__dirname, '..', 'src', 'auth', 'auth.service.ts'), 'utf8')
    const cliSource = readFileSync(resolve(__dirname, 'bootstrap-first-admin.ts'), 'utf8')
    assert.match(authSource, /passwordProofState === PASSWORD_PROOF_STATE\.TEMPORARY/)
    assert.match(authSource, /process\.env\['NODE_ENV'\] === 'production'/)
    assert.match(authSource, /setNxEx\(this\.firstAdminPasswordTicketKey/)
    assert.match(authSource, /getAndDelIfEquals/)
    assert.match(authSource, /randomBytes\(32\)/)
    assert.ok(cliSource.indexOf('writeCredentialsFile(') < cliSource.indexOf('createFirstAdmin('))
    assert.match(cliSource, /databaseCommitted/)
    assert.match(cliSource, /FIRST_ADMIN_BOOTSTRAP_RECONCILIATION_REQUIRED/)
    assert.doesNotMatch(cliSource, /unlinkSync|rmSync|removeCreatedCredentialsFile/)
    assert.doesNotMatch(cliSource, /temporaryPassword[^\n]*console/)
    pass('临时生产admin无JWT、单ticket原子消费与凭据先落盘合同已接线')

    await verifyFirstAdminPasswordChangeFlow()
    pass('初始密码只换ticket，单次改密后才签发完整JWT')

    console.log(`\nALL PASS (${passed})`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function verifyFirstAdminPasswordChangeFlow(): Promise<void> {
  const initialPassword = 'Initial-Admin-Password-A1!'
  const user = {
    id: 'bootstrap-admin-id',
    username: 'bootstrap.admin',
    passwordHash: await bcrypt.hash(initialPassword, 4),
    passwordProofState: 'temporary',
    name: '首个管理员',
    role: 'admin',
    orgId: null,
    enabled: true,
    phoneHash: null,
    phoneEnc: null,
    phoneVerifiedAt: null,
    emailHash: null,
    emailEnc: null,
    emailVerifiedAt: null,
    emailVerifyMethod: null,
    tokenVersion: 0,
    deletedAt: null,
  }
  let bootstrapAuditPresent = true
  const requiredAudits: string[] = []
  const ticketState = new Map<string, string>()
  let jwtSigns = 0
  const prisma = {
    user: {
      findFirst: async () => ({ ...user }),
      updateMany: async () => ({ count: 1 }),
    },
    organization: { findUnique: async () => null },
    auditLog: {
      findFirst: async () => bootstrapAuditPresent ? { id: 'bootstrap-audit' } : null,
    },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
      user: {
        updateMany: async ({ data }: { data: { passwordHash: string; passwordProofState: string; tokenVersion: { increment: number } } }) => {
          user.passwordHash = data.passwordHash
          user.passwordProofState = data.passwordProofState
          user.tokenVersion += data.tokenVersion.increment
          return { count: 1 }
        },
      },
      auditLog: {
        create: async ({ data }: { data: { action: string } }) => {
          requiredAudits.push(data.action)
          return { id: 'password-change-audit' }
        },
      },
    }),
  }
  const redis = {
    setNxEx: async (key: string, value: string) => {
      if (ticketState.has(key)) return false
      ticketState.set(key, value)
      return true
    },
    getAndDelIfEquals: async (key: string, expected: string) => {
      const actual = ticketState.get(key)
      if (actual === undefined) return 'missing'
      if (actual !== expected) return 'mismatched'
      ticketState.delete(key)
      return 'matched'
    },
    setJsonIfVersionNotOlder: async () => 'written',
    del: async () => 1,
  }
  const auth = new AuthService(
    { sign: () => { jwtSigns += 1; return 'signed-jwt' } } as never,
    prisma as never,
    redis as never,
    {} as never,
    { write: async () => 'audit-id' } as never,
  )
  const previousNodeEnv = process.env['NODE_ENV']
  process.env['NODE_ENV'] = 'production'
  try {
    const first = await auth.login(user.username, initialPassword, 'admin')
    assert.ok('passwordChangeRequired' in first && first.passwordChangeRequired)
    assert.equal(jwtSigns, 0)
    await assert.rejects(() => auth.login(user.username, initialPassword, 'admin'), (error: unknown) => {
      return nestErrorCode(error) === 'AUTH_FIRST_ADMIN_PASSWORD_CHANGE_PENDING'
    })
    const ticket = 'changeTicket' in first ? first.changeTicket : ''
    const lastTicketCharacter = ticket.slice(-1)
    const wrongTicket = `${ticket.slice(0, -1)}${lastTicketCharacter === 'A' ? 'B' : 'A'}`
    await assert.rejects(() => auth.completeFirstAdminPasswordChange(wrongTicket, 'Attacker-Password-A3!'), (error: unknown) => {
      return nestErrorCode(error) === 'AUTH_FIRST_ADMIN_PASSWORD_CHANGE_FAILED'
    })
    await auth.completeFirstAdminPasswordChange(ticket, 'Owner-Managed-Password-A2!')
    await assert.rejects(() => auth.completeFirstAdminPasswordChange(ticket, 'Replay-Password-A4!'), (error: unknown) => {
      return nestErrorCode(error) === 'AUTH_FIRST_ADMIN_PASSWORD_CHANGE_FAILED'
    })
    pass('错误secret不消费合法ticket，合法ticket只能消费一次')
    assert.equal(user.passwordProofState, 'owner_managed')
    assert.equal(user.tokenVersion, 1)
    assert.deepEqual(requiredAudits, ['auth.first_admin_bootstrap.password_changed'])
    const normal = await auth.login(user.username, 'Owner-Managed-Password-A2!', 'admin')
    assert.ok('token' in normal && normal.token === 'signed-jwt')
    assert.equal(jwtSigns, 1)

    user.passwordProofState = 'temporary'
    bootstrapAuditPresent = false
    await assert.rejects(() => auth.login(user.username, 'Owner-Managed-Password-A2!', 'admin'), (error: unknown) => {
      return nestErrorCode(error) === 'AUTH_TEMPORARY_ADMIN_LOCKED'
    })
    assert.equal(jwtSigns, 1)
  } finally {
    if (previousNodeEnv === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = previousNodeEnv
  }
}

function nestErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  if (!response || typeof response !== 'object') return null
  const nested = (response as { error?: unknown }).error
  if (!nested || typeof nested !== 'object') return null
  const code = (nested as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

void main()
