/**
 * isSerializationConflict 的单元断言 + 全仓静态扫描（不连数据库，两个 CI 作业都跑）。
 *
 * 规格：PostgreSQL 可串行化冲突（SQLSTATE 40001）在 adapter-pg 下有两种形状，
 * 两种都必须认成冲突；与冲突无关的错误（唯一约束、业务异常、空值）一律不认，
 * 否则会把不该重试的失败重试掉、或把真故障报成「并发冲突，请重试」。
 *
 * 静态扫描：services/api/src 里除共用函数本身外不许再出现 'P2034' 字面量 ——
 * 只认 P2034 的写法正是这次 500 的来源，任何调用点改回去都必须在这里变红。
 * 真 PG 并发用例见 verify:pg-serialization-conflict:postgres 与 verify:first-admin-bootstrap:postgres。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Prisma } from '../src/generated/prisma/client'
import { isSerializationConflict } from '../src/common/prisma/serialization-conflict'

const API_ROOT = resolve(__dirname, '..')
const SRC_ROOT = join(API_ROOT, 'src')
const HELPER = 'src/common/prisma/serialization-conflict.ts'

/** 必须经共用函数判断冲突的调用点（2026-09-29 全仓只认 P2034 的六处）。 */
const CALL_SITES = [
  'src/auth/first-admin-bootstrap.ts',
  'src/auth/partner-phone-rebind.service.ts',
  'src/member-privacy/member-privacy.service.ts',
  'src/orgs/admin-orgs.service.ts',
  'src/scan-tasks/scan-tasks.service.ts',
  'src/terminals/release-observation.service.ts',
]

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`  PASS ${name}`)
}

/** 2026-09-29 本机 PG 16 + Prisma 7.8 实测到的 COMMIT 冲突原始形状（字段逐一照录）。 */
function driverAdapterCommitConflict(): Error {
  return Object.assign(new Error('TransactionWriteConflict'), {
    name: 'DriverAdapterError',
    cause: {
      originalCode: '40001',
      originalMessage: 'could not serialize access due to read/write dependencies among transactions',
      kind: 'TransactionWriteConflict',
    },
  })
}

console.log('verify-pg-serialization-conflict')

check('P2034 PrismaClientKnownRequestError（冲突发生在查询上）', () => {
  const error = new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: Prisma.prismaVersion.client },
  )
  assert.equal(isSerializationConflict(error), true)
})

check('DriverAdapterError（冲突发生在 COMMIT 上，没有 code）', () => {
  const error = driverAdapterCommitConflict()
  assert.equal((error as { code?: unknown }).code, undefined)
  assert.equal(isSerializationConflict(error), true)
})

check('DriverAdapterError 只凭 cause 也认得（message 改了也不漏）', () => {
  const byKind = Object.assign(new Error('x'), { cause: { kind: 'TransactionWriteConflict' } })
  const byCode = Object.assign(new Error('x'), { cause: { originalCode: '40001' } })
  assert.equal(isSerializationConflict(byKind), true)
  assert.equal(isSerializationConflict(byCode), true)
})

check('message 含 40001 / could not serialize', () => {
  assert.equal(isSerializationConflict(new Error('ERROR: 40001 serialization failure')), true)
  assert.equal(isSerializationConflict(new Error('could not serialize access due to concurrent update')), true)
})

check('无关错误一律不认', () => {
  const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
  })
  const uniqueAtAdapter = Object.assign(new Error('UniqueConstraintViolation'), {
    name: 'DriverAdapterError',
    cause: { originalCode: '23505', kind: 'UniqueConstraintViolation' },
  })
  for (const error of [unique, uniqueAtAdapter, new Error('FIRST_ADMIN_BOOTSTRAP_NOT_EMPTY'), null, undefined, 'P2034', 40001]) {
    assert.equal(isSerializationConflict(error), false, `must not treat ${String(error)} as a serialization conflict`)
  }
})

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name === 'generated' || name === '__tests__' || name === 'node_modules') continue
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full))
    else if (/\.(ts|js|mjs|cjs)$/.test(name)) out.push(full)
  }
  return out
}

check("静态扫描：src 里除共用函数外没有 'P2034' 字面量", () => {
  const offenders = listSourceFiles(SRC_ROOT)
    .map((file) => relative(API_ROOT, file).split('\\').join('/'))
    .filter((file) => file !== HELPER)
    .filter((file) => /['"`]P2034['"`]/.test(readFileSync(join(API_ROOT, file), 'utf8')))
  assert.deepEqual(offenders, [], `serialization conflicts must be recognized via isSerializationConflict(): ${offenders.join(', ')}`)
})

check('静态扫描：六个调用点都经共用函数判断冲突', () => {
  for (const file of CALL_SITES) {
    const source = readFileSync(join(API_ROOT, file), 'utf8')
    assert.match(source, /from '\.\.\/common\/prisma\/serialization-conflict'/, `${file} must import the shared helper`)
    assert.match(source, /isSerializationConflict\((error|e)\)/, `${file} must call isSerializationConflict()`)
    assert.doesNotMatch(source, /function isSerializationConflict|function isPrismaSerializationConflict/,
      `${file} must not keep a local copy of the conflict check`)
  }
})

console.log(`verify-pg-serialization-conflict: ${passed}/7 PASS`)
