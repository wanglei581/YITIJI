/**
 * 文件端点「内部账号身份必须回源」验证。
 *
 * 背景(CLAUDE.md §11):/files/:id/download-url、/files/:id/preview-url、
 * DELETE /files/:id 等混合鉴权端点同时接受会员 token 和内部账号(admin / partner /
 * kiosk)token。会员那条路径一直回源数据库;内部账号那条路径曾经只 verify 签名就
 * 采信 JWT 里的 role/orgId 声明,导致一个已停用 / 已删除 / tokenVersion 已作废的
 * 管理员账号,只要手上 token 未过期,仍能读取或删除任意求职者的简历与证件扫描件。
 *
 * 本脚本用真实 JwtService + 真实 FilesController + 真实 canAccessFile,
 * 只把 Prisma / Redis / 存储替换成内存桩,断言的是端点行为(401 / 403 / 放行),
 * 不是源码写法。无需数据库、Redis 或网络。
 *
 * Run: pnpm --filter @ai-job-print/api verify:file-internal-auth
 */
import assert from 'node:assert/strict'
import { JwtService } from '@nestjs/jwt'
import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { FilesController } from '../src/files/files.controller'
import { canAccessFile, type FileRequester } from '../src/files/files.service'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../src/common/constants/internal-session.constants'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'

const JWT_SECRET = 'verify-file-internal-auth-secret-0123456789'
const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '2h' } })

/** 目标文件:某会员上传的简历(ownerType='user'),内部账号绝不该随手拿到。 */
const MEMBER_RESUME = {
  id: 'file-member-resume',
  uploaderId: null as string | null,
  endUserId: 'enduser-victim',
  ownerType: 'user' as string | null,
  ownerId: 'enduser-victim' as string | null,
  purpose: 'resume',
  filename: 'resume.pdf',
  sensitiveLevel: 'highly_sensitive',
}

type UserRow = {
  id: string
  role: string
  orgId: string | null
  enabled: boolean
  tokenVersion: number
  deletedAt: Date | null
}

type EndUserRow = { id: string; enabled: boolean; status: string }

interface WorldOptions {
  users?: UserRow[]
  orgs?: Array<{ id: string; enabled: boolean }>
  endUsers?: EndUserRow[]
  /** 预置的 internal:session-state 缓存(模拟热路径缓存命中)。 */
  seedSessionState?: Array<{ key: string; value: string }>
  memberSessions?: Array<{ sessionId: string; endUserId: string }>
}

interface Calls {
  userFindUnique: number
  orgFindUnique: number
  getAccessUrl: number
  ownerDelete: number
  redisGet: number
}

function createWorld(options: WorldOptions = {}) {
  const calls: Calls = {
    userFindUnique: 0,
    orgFindUnique: 0,
    getAccessUrl: 0,
    ownerDelete: 0,
    redisGet: 0,
  }
  const store = new Map<string, string>()
  for (const seed of options.seedSessionState ?? []) store.set(seed.key, seed.value)
  for (const session of options.memberSessions ?? []) {
    store.set(memberSessionKey(session.sessionId), session.endUserId)
  }

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.userFindUnique += 1
        return (options.users ?? []).find((u) => u.id === where.id) ?? null
      },
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.orgFindUnique += 1
        return (options.orgs ?? []).find((o) => o.id === where.id) ?? null
      },
    },
    endUser: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return (options.endUsers ?? []).find((e) => e.id === where.id) ?? null
      },
    },
  }

  const redis = {
    get: async (key: string) => {
      calls.redisGet += 1
      return store.get(key) ?? null
    },
    del: async (key: string) => {
      store.delete(key)
    },
    setJsonIfVersionNotOlder: async (key: string, _ttl: number, value: string) => {
      store.set(key, value)
      return 'stored' as const
    },
    unregisterMemberSession: async (_endUserId: string, sessionId: string) => {
      store.delete(memberSessionKey(sessionId))
    },
  }

  /** 只保留鉴权语义:归属判定用真实 canAccessFile,其余全部是最小桩。 */
  const files = {
    getAccessUrl: async (fileId: string, requester: FileRequester, disposition: string) => {
      calls.getAccessUrl += 1
      if (fileId !== MEMBER_RESUME.id) {
        throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' } })
      }
      if (!canAccessFile(MEMBER_RESUME, requester)) {
        throw new ForbiddenException({ error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' } })
      }
      return {
        response: { fileId, url: 'https://stub/download', disposition },
        record: { purpose: MEMBER_RESUME.purpose, ownerType: MEMBER_RESUME.ownerType },
        needsAdminAudit: requester.kind === 'user' && requester.role === 'admin',
      }
    },
    ownerDelete: async (fileId: string, requester: FileRequester) => {
      calls.ownerDelete += 1
      if (!canAccessFile(MEMBER_RESUME, requester)) {
        throw new ForbiddenException({ error: { code: 'FILE_ACCESS_DENIED', message: '无权删除此文件' } })
      }
      return { id: fileId, filename: MEMBER_RESUME.filename, sensitiveLevel: MEMBER_RESUME.sensitiveLevel }
    },
  }

  const audit = { write: async () => undefined }

  const controller = new FilesController(
    files as never,
    audit as never,
    jwt,
    redis as never,
    prisma as never,
  )

  return { controller, calls, store }
}

function request(token: string | null) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ip: '127.0.0.1',
    requestId: 'verify-request',
  } as never
}

function responseCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.() as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

function statusOf(error: unknown): number | undefined {
  return (error as { getStatus?: () => number })?.getStatus?.()
}

async function expectRejection(
  action: () => Promise<unknown>,
  expected: { status: number; code: string },
  message: string,
): Promise<void> {
  let thrown: unknown
  try {
    await action()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, `${message}:期望被拒绝,实际放行`)
  assert.equal(statusOf(thrown), expected.status, `${message}:HTTP 状态不符`)
  assert.equal(responseCode(thrown), expected.code, `${message}:错误码不符`)
}

const ACTIVE_ADMIN: UserRow = {
  id: 'admin-1',
  role: 'admin',
  orgId: null,
  enabled: true,
  tokenVersion: 3,
  deletedAt: null,
}

function internalToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload)
}

const failures: string[] = []
let passed = 0

/**
 * 逐个场景执行:失败只记录不中断,便于在「未修复代码」上一次看全所有会红的断言。
 */
async function scenario(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
    passed += 1
    console.log(`  PASS ${label}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    failures.push(`${label}\n      ${detail.split('\n')[0]}`)
    console.log(`  FAIL ${label}`)
    console.log(`       ${detail.split('\n')[0]}`)
  }
}

async function main(): Promise<void> {
  console.log('文件端点内部账号身份回源验证')

  // 1. 停用的管理员:token 未过期,但账号已被停用 → 必须 401,且不得进入文件服务。
  await scenario('已停用管理员 GET /files/:id/download-url → 401,未触达文件服务', async () => {
    const world = createWorld({ users: [{ ...ACTIVE_ADMIN, enabled: false }] })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    await expectRejection(
      () => world.controller.downloadUrl(MEMBER_RESUME.id, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '已停用管理员下载求职者简历',
    )
    assert.equal(world.calls.getAccessUrl, 0, '已停用管理员不得进入 FilesService.getAccessUrl')
    assert.ok(world.calls.userFindUnique >= 1, '内部身份判定必须回源数据库')
  })

  // 2. 已软删除的管理员 → DELETE 必须 401,且不得真的删除会员简历。
  await scenario('已软删除管理员 DELETE /files/:id → 401,未触达删除', async () => {
    const world = createWorld({ users: [{ ...ACTIVE_ADMIN, deletedAt: new Date() }] })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    await expectRejection(
      () => world.controller.remove(MEMBER_RESUME.id, 'cleanup', request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '已删除管理员删除求职者简历',
    )
    assert.equal(world.calls.ownerDelete, 0, '已删除管理员不得进入 FilesService.ownerDelete')
  })

  // 3. tokenVersion 作废(改密 / 强制下线)的管理员 → 401。
  await scenario('tokenVersion 已作废的管理员 → 401', async () => {
    const world = createWorld({ users: [{ ...ACTIVE_ADMIN, tokenVersion: 4 }] })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    await expectRejection(
      () => world.controller.downloadUrl(MEMBER_RESUME.id, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      'tokenVersion 已作废的管理员',
    )
    assert.equal(world.calls.getAccessUrl, 0, 'tokenVersion 作废后不得进入文件服务')
  })

  // 4. 账号已被硬删除(数据库查不到)→ 401。
  await scenario('数据库已无此内部账号 → 401', async () => {
    const world = createWorld({ users: [] })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    await expectRejection(
      () => world.controller.previewUrl(MEMBER_RESUME.id, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '数据库已无此账号',
    )
  })

  // 5. 越权提升:token 声明 admin,数据库里其实是 partner → 必须按数据库角色判定,
  //    partner 拿不到会员简历(403),而不是被 JWT 声明抬成 admin 放行。
  await scenario('role 以数据库为准:token 声明 admin 的 partner 账号 → 403', async () => {
    const world = createWorld({
      users: [{ id: 'p-1', role: 'partner', orgId: 'org-1', enabled: true, tokenVersion: 1, deletedAt: null }],
      orgs: [{ id: 'org-1', enabled: true }],
    })
    const token = internalToken({ sub: 'p-1', role: 'admin', orgId: null, ver: 1 })
    await expectRejection(
      () => world.controller.downloadUrl(MEMBER_RESUME.id, request(token)),
      { status: 403, code: 'FILE_ACCESS_DENIED' },
      'JWT 声明 admin 但数据库是 partner',
    )
  })

  // 6. partner 账号所属机构已停用 → 401。
  await scenario('partner 所属机构已停用 → 401', async () => {
    const world = createWorld({
      users: [{ id: 'p-1', role: 'partner', orgId: 'org-1', enabled: true, tokenVersion: 1, deletedAt: null }],
      orgs: [{ id: 'org-1', enabled: false }],
    })
    const token = internalToken({ sub: 'p-1', role: 'partner', orgId: 'org-1', ver: 1 })
    await expectRejection(
      () => world.controller.downloadUrl(MEMBER_RESUME.id, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '所属机构已停用的 partner',
    )
  })

  // 7. 正向对照:在职管理员仍然可以访问(修复不得误伤正常运营)。
  await scenario('在职管理员 GET /files/:id/download-url → 放行(无回归)', async () => {
    const world = createWorld({ users: [ACTIVE_ADMIN] })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    const result = await world.controller.downloadUrl(MEMBER_RESUME.id, request(token))
    assert.equal(result.data?.fileId, MEMBER_RESUME.id, '在职管理员必须仍能取得下载 URL')
    assert.equal(world.calls.getAccessUrl, 1, '在职管理员必须进入文件服务')
  })

  // 8. 会员路径不受影响:仍然回源 EndUser,且身份是 member 而不是内部账号。
  await scenario('会员本人路径未受影响(仍走 EndUser 回源)', async () => {
    const world = createWorld({
      endUsers: [{ id: 'enduser-victim', enabled: true, status: 'active' }],
      memberSessions: [{ sessionId: 'sess-1', endUserId: 'enduser-victim' }],
    })
    const memberToken = jwt.sign({ sub: 'enduser-victim', jti: 'sess-1', aud: 'enduser' })
    const result = await world.controller.downloadUrl(MEMBER_RESUME.id, request(memberToken))
    assert.equal(result.data?.fileId, MEMBER_RESUME.id, '会员本人必须仍能访问自己的文件')
    assert.equal(world.calls.userFindUnique, 0, '会员 token 不得走内部账号回源分支')
  })

  // 9. 停用的会员即使 token 有效,也不得被内部分支「捡回来」当成内部账号。
  await scenario('aud=enduser token 不会退化成内部账号身份', async () => {
    const world = createWorld({
      endUsers: [{ id: 'enduser-victim', enabled: false, status: 'disabled' }],
      memberSessions: [{ sessionId: 'sess-1', endUserId: 'enduser-victim' }],
      users: [{ ...ACTIVE_ADMIN, id: 'enduser-victim' }],
    })
    const memberToken = jwt.sign({ sub: 'enduser-victim', jti: 'sess-1', aud: 'enduser' })
    await expectRejection(
      () => world.controller.downloadUrl(MEMBER_RESUME.id, request(memberToken)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '已停用会员的 aud=enduser token',
    )
    assert.equal(world.calls.getAccessUrl, 0, 'aud=enduser token 不得被当作内部账号放行')
  })

  // 10. 性能取舍的安全下界:会话状态缓存必须有界。缓存命中可以省掉数据库查询,
  //     但 TTL 必须足够短,否则「停用即生效」变成空话。
  await scenario(`会话状态缓存有界(TTL=${INTERNAL_SESSION_CACHE_TTL_SECONDS}s)且缓存命中不查库`, async () => {
    assert.ok(
      INTERNAL_SESSION_CACHE_TTL_SECONDS > 0 && INTERNAL_SESSION_CACHE_TTL_SECONDS <= 60,
      `内部会话状态缓存 TTL 必须在 (0, 60] 秒,当前 ${INTERNAL_SESSION_CACHE_TTL_SECONDS}`,
    )
    // 热路径:缓存命中的非 partner 账号不再查库。
    const cached = JSON.stringify({
      userId: 'admin-1',
      role: 'admin',
      orgId: null,
      enabled: true,
      tokenVersion: 3,
      deletedAt: null,
      orgEnabled: null,
    })
    const world = createWorld({
      users: [ACTIVE_ADMIN],
      seedSessionState: [{ key: 'internal:session-state:admin-1', value: cached }],
    })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    await world.controller.downloadUrl(MEMBER_RESUME.id, request(token))
    assert.equal(world.calls.userFindUnique, 0, '缓存命中的非 partner 账号不应再查库(热路径成本)')
  })

  // 11. 停用写入缓存墓碑后必须立刻生效,而不是等 TTL 过期。
  await scenario('停用墓碑写入缓存后立即生效,无需等待 TTL', async () => {
    const tombstone = JSON.stringify({
      userId: 'admin-1',
      role: 'admin',
      orgId: null,
      enabled: false,
      tokenVersion: 3,
      deletedAt: new Date().toISOString(),
      orgEnabled: null,
    })
    const world = createWorld({
      users: [ACTIVE_ADMIN],
      seedSessionState: [{ key: 'internal:session-state:admin-1', value: tombstone }],
    })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    await expectRejection(
      () => world.controller.downloadUrl(MEMBER_RESUME.id, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '缓存墓碑(已停用)',
    )
  })

  // 12. partner 缓存命中仍必须回源,防止 Redis 残留把已删机构账号短暂复活。
  await scenario('partner 缓存命中仍回源,陈旧缓存无法复活已停用账号', async () => {
    const stalePartner = JSON.stringify({
      userId: 'p-1',
      role: 'partner',
      orgId: 'org-1',
      enabled: true,
      tokenVersion: 1,
      deletedAt: null,
      orgEnabled: true,
    })
    const world = createWorld({
      users: [{ id: 'p-1', role: 'partner', orgId: 'org-1', enabled: false, tokenVersion: 1, deletedAt: null }],
      orgs: [{ id: 'org-1', enabled: true }],
      seedSessionState: [{ key: 'internal:session-state:p-1', value: stalePartner }],
    })
    const token = internalToken({ sub: 'p-1', role: 'partner', orgId: 'org-1', ver: 1 })
    await expectRejection(
      () => world.controller.downloadUrl(MEMBER_RESUME.id, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      'partner 陈旧缓存',
    )
    assert.ok(world.calls.userFindUnique >= 1, 'partner 缓存命中也必须回源数据库')
  })

  // 13. 上传意图 / 完成上传两条写入路径同样必须回源。
  await scenario('upload-intent / retention 两条路径同样按当前账号状态拒绝', async () => {
    const world = createWorld({ users: [{ ...ACTIVE_ADMIN, enabled: false }] })
    const token = internalToken({ sub: 'admin-1', role: 'admin', orgId: null, ver: 3 })
    await expectRejection(
      () => world.controller.uploadIntent({ purpose: 'resume' } as never, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '已停用管理员创建上传意图',
    )
    await expectRejection(
      () => world.controller.updateRetention(MEMBER_RESUME.id, {} as never, request(token)),
      { status: 401, code: 'AUTH_REQUIRED' },
      '已停用管理员修改保存期限',
    )
  })

  if (failures.length > 0) {
    console.error(`\n${failures.length} 项失败:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    throw new Error(`文件端点内部账号身份回源验证失败:${failures.length}/${failures.length + passed}`)
  }
  console.log(`\nALL PASS (${passed} 项)`)
}

main().catch((error) => {
  console.error('\nFAIL', error instanceof Error ? error.message : error)
  process.exit(1)
})
