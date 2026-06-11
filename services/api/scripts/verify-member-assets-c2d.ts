/**
 * Phase C-2D 会员资产真实管理 — 真实 HTTP E2E 验证（不是 mock）。
 *
 * 启动真实 Nest 应用（与 main.ts 同配置：/api/v1 前缀 + 全局 ValidationPipe +
 * HttpExceptionFilter），用 dev 短信通道（SMS_PROVIDER=log，验证码落 Redis）完成
 * 两个会员的真实登录，再通过 HTTP 验证：
 *
 *  1. 短信验证码登录：错码 401，正码下发会员 token
 *  2. /me/resumes 含 kind=generate（AI 生成简历绝不展示为「简历解析」）+ optimized 标注
 *  3. /me/ai-records 三种 kind 如实区分
 *  4. 游标分页：pageSize 封顶 50、非法 pageSize 400、游标遍历不重不漏、total 真实
 *  5. 跨会员隔离：B 看不到 A 的资产；B 删 A 的 AI 记录 / 文件被拒，数据无损
 *  6. AI 记录删除：硬删 + parse 级联删 optimize + 审计落库（actorRole=enduser）
 *  7. 文档删除：对象存储物理删除 + DB 行软删（保留删除日志字段）+ 审计落库
 *  8. 收藏幂等：重复收藏仅一行；取消收藏幂等
 *  9. 登出后 token 立即失效（Redis 会话删除 → 401）；匿名访问 401
 *
 * 运行：pnpm --filter @ai-job-print/api verify:member-assets-c2d
 * 前置：Redis 可达（REDIS_URL）；本脚本强制 FILE_STORAGE_DRIVER=local（绝不触达 COS）。
 * 自建自清理：测试会员 / 结果 / 文件 / 收藏 / 审计行全部清除。
 */

// 必须在加载 .env 之前钉死：文件验证走本地存储（物理删除断言需要本地路径，且绝不触达生产 COS）。
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_STORAGE_DIR'] = process.env['C2D_VERIFY_STORAGE_DIR'] ?? ''
if (!process.env['FILE_STORAGE_DIR']) {
  // path 在顶部 import 会被 hoist 到 env 赋值之前也无妨——这里只用 os/path 计算常量
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  process.env['FILE_STORAGE_DIR'] = path.join(os.tmpdir(), 'c2d-verify-storage')
}
if (!process.env['SMS_PROVIDER']) process.env['SMS_PROVIDER'] = 'log'
require('dotenv').config()

import * as fs from 'fs'
import * as path from 'path'
import { Redis } from 'ioredis'

let passCount = 0
function pass(msg: string) {
  passCount += 1
  console.log(`  PASS ${msg}`)
}
function fail(msg: string): never {
  console.error(`  FAIL ${msg}`)
  throw new Error(`VERIFY FAILED: ${msg}`)
}

interface HttpResult {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function main() {
  const { NestFactory } = await import('@nestjs/core')
  const { BadRequestException, ValidationPipe } = await import('@nestjs/common')
  const { AppModule } = await import('../src/app.module')
  const { HttpExceptionFilter } = await import('../src/common/filters/http-exception.filter')
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { FilesService } = await import('../src/files/files.service')
  const { hashPhone } = await import('../src/common/crypto/phone-identity')

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: () =>
        new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0)
  const address = app.getHttpServer().address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/v1`

  const prisma = app.get(PrismaService)
  const files = app.get(FilesService)
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')

  const suffix = Date.now().toString(36)
  const PHONE_A = '13912340701'
  const PHONE_B = '13912340702'
  const hashA = hashPhone(PHONE_A)
  const hashB = hashPhone(PHONE_B)

  const http = async (
    method: string,
    p: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<HttpResult> => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* empty body */
    }
    return { status: res.status, body }
  }

  // 清理函数（前置清理保证可重复运行；finally 再清一次）
  const cleanup = async () => {
    const users = await prisma.endUser.findMany({
      where: { phoneHash: { in: [hashA, hashB] } },
      select: { id: true },
    })
    const userIds = users.map((u) => u.id)
    if (userIds.length > 0) {
      await prisma.favorite.deleteMany({ where: { endUserId: { in: userIds } } })
      await prisma.aiResumeResult.deleteMany({ where: { endUserId: { in: userIds } } })
      await prisma.fileObject.deleteMany({ where: { endUserId: { in: userIds } } })
      await prisma.printTask.deleteMany({ where: { endUserId: { in: userIds } } })
      await prisma.endUser.deleteMany({ where: { id: { in: userIds } } })
    }
    await prisma.auditLog.deleteMany({
      where: { action: { in: ['member.ai_record_delete', 'file.delete'] }, payloadJson: { contains: suffix } },
    })
    // 频控/验证码键清掉，保证脚本可立即重跑
    for (const h of [hashA, hashB]) {
      const keys = await redis.keys(`member:sms:*${h}*`)
      if (keys.length > 0) await redis.del(...keys)
    }
  }

  try {
    await cleanup()

    // ── 1. dev SMS 真实登录 ────────────────────────────────────────────────
    const login = async (phone: string, hash: string): Promise<string> => {
      const sent = await http('POST', '/member/auth/sms-code', { body: { phone, deviceId: `verify-${suffix}` } })
      if (sent.status !== 200 && sent.status !== 201) fail(`发送验证码失败 status=${sent.status} ${JSON.stringify(sent.body)}`)
      const code = await redis.get(`member:sms:code:${hash}`)
      if (!code) fail('Redis 中未找到验证码（SMS_PROVIDER=log 通道）')
      const wrong = await http('POST', '/member/auth/login', { body: { phone, code: '000000' === code ? '111111' : '000000' } })
      if (wrong.status !== 401) fail(`错误验证码应 401，实际 ${wrong.status}`)
      const ok = await http('POST', '/member/auth/login', { body: { phone, code } })
      if (ok.status !== 200 && ok.status !== 201) fail(`登录失败 status=${ok.status} ${JSON.stringify(ok.body)}`)
      const token = ok.body?.data?.token
      if (typeof token !== 'string' || !token) fail('登录响应缺少 token')
      return token
    }
    const tokenA = await login(PHONE_A, hashA)
    const tokenB = await login(PHONE_B, hashB)
    pass('1. dev SMS 真实登录：错码 401 / 正码登录成功（A、B 两会员）')

    const userA = await prisma.endUser.findFirst({ where: { phoneHash: hashA }, select: { id: true } })
    const userB = await prisma.endUser.findFirst({ where: { phoneHash: hashB }, select: { id: true } })
    if (!userA || !userB) fail('EndUser 行未落库')

    // ── 种子数据：A 三种 AI 记录 + 一个文件；B 一条 parse ────────────────────
    const future = new Date(Date.now() + 3600_000)
    const t1 = `c2dtask1_${suffix}`
    const t2 = `c2dtask2_${suffix}`
    const t3 = `c2dtask3_${suffix}`
    const mkResult = (taskId: string, kind: string, endUserId: string) =>
      prisma.aiResumeResult.create({
        data: {
          taskId,
          kind,
          status: 'completed',
          provider: 'mock',
          payloadJson: JSON.stringify({ taskId, status: 'completed', suffix }),
          endUserId,
          expiresAt: future,
        },
        select: { id: true },
      })
    const rowParseA = await mkResult(t1, 'parse', userA.id)
    await mkResult(t1, 'optimize', userA.id)
    const rowGenA = await mkResult(t2, 'generate', userA.id)
    await mkResult(t3, 'parse', userB.id)

    const uploaded = await files.upload({
      buffer: Buffer.from(`%PDF-1.4 c2d verify ${suffix}\n%%EOF`),
      filename: `c2d-verify-${suffix}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: userA.id,
    })
    const fileRow = await prisma.fileObject.findUnique({
      where: { id: uploaded.fileId },
      select: { storageKey: true },
    })
    if (!fileRow) fail('上传文件行未落库')
    const physicalPath = path.resolve(process.env['FILE_STORAGE_DIR']!, fileRow.storageKey)
    if (!fs.existsSync(physicalPath)) fail(`本地存储对象不存在: ${physicalPath}`)

    // ── 2. /me/resumes：kind=generate 如实展示 + optimized 标注 + 本人 only ──
    const resumesA = await http('GET', '/me/resumes', { token: tokenA })
    if (resumesA.status !== 200) fail(`/me/resumes status=${resumesA.status}`)
    const rItems = (resumesA.body?.data?.items ?? []) as Array<Record<string, unknown>>
    const rParse = rItems.find((r) => r['taskId'] === t1)
    const rGen = rItems.find((r) => r['taskId'] === t2)
    if (!rParse || rParse['kind'] !== 'parse' || rParse['optimized'] !== true) {
      fail(`parse 简历行缺失或 optimized 未标注: ${JSON.stringify(rParse)}`)
    }
    if (!rGen || rGen['kind'] !== 'generate') fail(`generate 简历行缺失或 kind 错误: ${JSON.stringify(rGen)}`)
    if (rItems.some((r) => r['taskId'] === t3)) fail('A 的简历列表泄露了 B 的数据')
    pass('2. /me/resumes：parse(已优化标注) + generate 并存，kind 如实，且只见本人')

    // ── 3. /me/ai-records：三种 kind 如实区分 ────────────────────────────────
    const recordsA = await http('GET', '/me/ai-records', { token: tokenA })
    const aItems = (recordsA.body?.data?.items ?? []) as Array<Record<string, unknown>>
    const kinds = new Set(aItems.filter((a) => [t1, t2].includes(a['taskId'] as string)).map((a) => a['kind']))
    if (!kinds.has('parse') || !kinds.has('optimize') || !kinds.has('generate')) {
      fail(`AI 记录 kind 不全: ${[...kinds].join(',')}`)
    }
    if (aItems.some((a) => a['kind'] === 'generate' && a['taskId'] === t2) === false) fail('generate 记录缺失')
    pass('3. /me/ai-records：parse / optimize / generate 三种 kind 如实区分')

    // ── 4. 游标分页：封顶 / 非法 400 / 遍历不重不漏 / total 真实 ────────────
    const favSeed = Array.from({ length: 55 }, (_, i) => ({
      endUserId: userA.id,
      targetType: 'job',
      targetId: `c2djob_${suffix}_${i}`,
      title: `分页测试岗位 ${i}`,
    }))
    for (const f of favSeed) await prisma.favorite.create({ data: f })

    const capped = await http('GET', '/me/favorites?pageSize=500', { token: tokenA })
    if (capped.status !== 200) fail(`pageSize=500 应被封顶而非报错，实际 ${capped.status}`)
    if ((capped.body?.data?.items ?? []).length !== 50) {
      fail(`pageSize 封顶失败: 返回 ${(capped.body?.data?.items ?? []).length} 条（应 50）`)
    }
    if (capped.body?.data?.total !== 55) fail(`total 应为 55，实际 ${capped.body?.data?.total}`)
    if (!capped.body?.data?.nextCursor) fail('55 条数据 pageSize=50 应有 nextCursor')

    const bad = await http('GET', '/me/favorites?pageSize=abc', { token: tokenA })
    if (bad.status !== 400 || bad.body?.error?.code !== 'MEMBER_PAGE_INVALID') {
      fail(`非法 pageSize 应 400 MEMBER_PAGE_INVALID，实际 ${bad.status} ${bad.body?.error?.code}`)
    }
    const zero = await http('GET', '/me/favorites?pageSize=0', { token: tokenA })
    if (zero.status !== 400) fail(`pageSize=0 应 400，实际 ${zero.status}`)

    const seen = new Set<string>()
    let cursor: string | null = null
    for (let i = 0; i < 20; i += 1) {
      const q: string = `/me/favorites?pageSize=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const page = await http('GET', q, { token: tokenA })
      const items = (page.body?.data?.items ?? []) as Array<{ id: string }>
      for (const it of items) {
        if (seen.has(it.id)) fail(`游标遍历出现重复行 ${it.id}`)
        seen.add(it.id)
      }
      cursor = page.body?.data?.nextCursor ?? null
      if (!cursor) break
    }
    if (seen.size !== 55) fail(`游标遍历应恰好 55 条，实际 ${seen.size}`)
    pass('4. 游标分页：pageSize 封顶 50 / 非法 400 / 遍历 55 条不重不漏 / total 真实')

    // ── 5. 跨会员隔离 ────────────────────────────────────────────────────────
    const resumesB = await http('GET', '/me/resumes', { token: tokenB })
    const bItems = (resumesB.body?.data?.items ?? []) as Array<Record<string, unknown>>
    if (bItems.some((r) => [t1, t2].includes(r['taskId'] as string))) fail('B 看到了 A 的简历')
    if (!bItems.some((r) => r['taskId'] === t3)) fail('B 看不到自己的简历')

    const bDelA = await http('DELETE', `/me/ai-records/${rowGenA.id}`, { token: tokenB })
    if (bDelA.status !== 404) fail(`B 删 A 的 AI 记录应 404，实际 ${bDelA.status}`)
    if (!(await prisma.aiResumeResult.findUnique({ where: { id: rowGenA.id } }))) fail('A 的记录被 B 误删')

    const bDelFile = await http('DELETE', `/files/${uploaded.fileId}?reason=test`, { token: tokenB })
    if (bDelFile.status === 200) fail('B 居然能删 A 的文件')
    const fileStill = await prisma.fileObject.findUnique({ where: { id: uploaded.fileId }, select: { deletedAt: true } })
    if (fileStill?.deletedAt) fail('A 的文件被 B 误删')
    pass(`5. 跨会员隔离：B 不可见/不可删 A 的资产（删记录 404 / 删文件 ${bDelFile.status}）`)

    // ── 6. AI 记录删除：硬删 + parse 级联 + 审计 ────────────────────────────
    const delParse = await http('DELETE', `/me/ai-records/${rowParseA.id}`, { token: tokenA })
    if (delParse.status !== 200) fail(`A 删自己 parse 记录失败 ${delParse.status}`)
    if (delParse.body?.data?.deletedCount !== 2) fail(`parse 级联应删 2 行，实际 ${delParse.body?.data?.deletedCount}`)
    const leftT1 = await prisma.aiResumeResult.count({ where: { taskId: t1 } })
    if (leftT1 !== 0) fail(`t1 应被级联清空，剩 ${leftT1} 行`)
    const auditAi = await prisma.auditLog.findFirst({
      where: { action: 'member.ai_record_delete', targetId: rowParseA.id },
      select: { actorRole: true, payloadJson: true },
    })
    if (!auditAi || auditAi.actorRole !== 'enduser') fail('AI 记录删除未写审计（actorRole=enduser）')
    if (!auditAi.payloadJson.includes(userA.id)) fail('审计 payload 缺 endUserId')
    pass('6. AI 记录删除：硬删 + parse 级联删 optimize（deletedCount=2）+ 审计落库')

    // ── 7. 文档删除：物理删除 + 软删行 + 审计 ────────────────────────────────
    const delFile = await http('DELETE', `/files/${uploaded.fileId}?reason=member-self-delete-${suffix}`, { token: tokenA })
    if (delFile.status !== 200) fail(`A 删自己文件失败 ${delFile.status} ${JSON.stringify(delFile.body)}`)
    if (fs.existsSync(physicalPath)) fail('对象存储文件未被物理删除')
    const fileAfter = await prisma.fileObject.findUnique({
      where: { id: uploaded.fileId },
      select: { status: true, deletedAt: true, deletedBy: true },
    })
    if (!fileAfter?.deletedAt || fileAfter.status !== 'deleted') fail('文件行未软删')
    if (!fileAfter.deletedBy?.includes(userA.id)) fail(`删除日志 deletedBy 缺会员标识: ${fileAfter.deletedBy}`)
    const auditFile = await prisma.auditLog.findFirst({
      where: { action: 'file.delete', targetId: uploaded.fileId },
      select: { actorRole: true, actorId: true, payloadJson: true },
    })
    if (!auditFile || auditFile.actorRole !== 'enduser' || auditFile.actorId !== null) {
      fail('文件删除审计缺失或 actor 形状错误（应 actorId=null + actorRole=enduser）')
    }
    if (!auditFile.payloadJson.includes(userA.id)) fail('文件删除审计 payload 缺 endUserId')
    const docsAfter = await http('GET', '/me/documents', { token: tokenA })
    if ((docsAfter.body?.data?.items ?? []).some((d: { id: string }) => d.id === uploaded.fileId)) {
      fail('已删文件仍出现在 /me/documents')
    }
    pass('7. 文档删除：对象物理删除 + 行软删（deletedBy=member）+ 审计 + 列表不再返回')

    // ── 8. 收藏幂等 ──────────────────────────────────────────────────────────
    const favTarget = `c2dfair_${suffix}`
    const add1 = await http('POST', '/me/favorites', { token: tokenA, body: { targetType: 'job_fair', targetId: favTarget, title: '幂等测试' } })
    const add2 = await http('POST', '/me/favorites', { token: tokenA, body: { targetType: 'job_fair', targetId: favTarget, title: '幂等测试' } })
    if (add1.status >= 300 || add2.status >= 300) fail('重复收藏不应报错')
    const favCount = await prisma.favorite.count({ where: { endUserId: userA.id, targetType: 'job_fair', targetId: favTarget } })
    if (favCount !== 1) fail(`重复收藏应只有 1 行，实际 ${favCount}`)
    const rm1 = await http('DELETE', `/me/favorites/job_fair/${favTarget}`, { token: tokenA })
    const rm2 = await http('DELETE', `/me/favorites/job_fair/${favTarget}`, { token: tokenA })
    if (rm1.body?.data?.removed !== true || rm2.body?.data?.removed !== false) fail('取消收藏幂等语义错误')
    pass('8. 收藏幂等：重复收藏仅 1 行；取消收藏幂等（removed true→false）')

    // ── 9. 登出失效 + 匿名 401 ──────────────────────────────────────────────
    const anon = await http('GET', '/me/resumes')
    if (anon.status !== 401 || anon.body?.error?.code !== 'MEMBER_MISSING_TOKEN') {
      fail(`匿名访问应 401 MEMBER_MISSING_TOKEN，实际 ${anon.status} ${anon.body?.error?.code}`)
    }
    const out = await http('POST', '/member/auth/logout', { token: tokenA })
    if (out.status !== 200 && out.status !== 201) fail(`登出失败 ${out.status}`)
    const afterLogout = await http('GET', '/me/resumes', { token: tokenA })
    if (afterLogout.status !== 401 || afterLogout.body?.error?.code !== 'MEMBER_SESSION_EXPIRED') {
      fail(`登出后应 401 MEMBER_SESSION_EXPIRED，实际 ${afterLogout.status} ${afterLogout.body?.error?.code}`)
    }
    const bStill = await http('GET', '/me/resumes', { token: tokenB })
    if (bStill.status !== 200) fail('A 登出不应影响 B 的会话')
    pass('9. 登出即失效（Redis 会话删除 → 401）；匿名 401；他人会话不受影响')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    try {
      await cleanup()
    } catch (e) {
      console.error('cleanup failed:', e)
    }
    redis.disconnect()
    await app.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
