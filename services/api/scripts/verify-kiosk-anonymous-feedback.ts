/**
 * A3 S1 — 一体机匿名反馈提交面验证。
 *
 * 背景：一体机是公共位设备，绝大多数用户不登录。改动前唯一的提交端点
 * POST /me/feedback 挂了 EndUserAuthGuard，P06 s7「问题上报 / 满意度」与
 * P39 打印 Hub 反馈弹层对匿名用户是**死按钮**。本脚本守门新增的
 * POST /kiosk/feedback 受限提交面。
 *
 * 每组都成对断言（先证明「会 FAIL 的那一边确实 FAIL」，再证明「该过的确实过」），
 * 避免出现「因为什么都没做所以全绿」的假通过：
 *   1. 匿名可提交 ×  会员端仍然挂鉴权、匿名端一个 guard 都没有
 *   2. 封闭词表通过 ×  越界 issueCode / 越界满意度 / 私带 category 一律 400
 *   3. 干净文本入库 ×  手机号 / 分隔符手机号 / 全角 / 零宽切分 / 身份证 / 邮箱 / 银行卡 / 超长 一律 400
 *   4. 限额内放行 ×  超额 429、另一终端不受影响、小时档独立生效、幂等命中不吃额度
 *   5. 本终端任务可关联 ×  跨终端 / 不存在的任务 ID 一律 400（且不构成存在性探测器）
 *   6. 不同内容分单 ×  相同内容（含并发）收敛成一条工单
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:kiosk-anonymous-feedback
 */
import 'dotenv/config'
import 'reflect-metadata'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { closeSync, openSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ValidationPipe, BadRequestException, type ValidationError } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { PrismaService } from '../src/prisma/prisma.service'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'
import { MemberFeedbackController } from '../src/member-feedback/member-feedback.controller'
import { KioskFeedbackController } from '../src/member-feedback/kiosk-feedback.controller'
import {
  ANONYMOUS_KIOSK_SUBMITTER,
  KIOSK_FEEDBACK_RATE_LIMITS,
  KioskFeedbackService,
} from '../src/member-feedback/kiosk-feedback.service'
import {
  CreateKioskFeedbackDto,
  KIOSK_FEEDBACK_CONTENT_MAX,
  KIOSK_FEEDBACK_ISSUE_CODES,
  KIOSK_FEEDBACK_ISSUE_MAP,
} from '../src/member-feedback/dto/kiosk-feedback.dto'
import { FEEDBACK_CATEGORIES } from '../src/member-feedback/dto/member-feedback.dto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const apiRoot = path.resolve(__dirname, '..')
const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-kiosk-anon-feedback-${randomUUID().slice(0, 8)}.db`
const fallbackDbPath = fallbackDbName ? path.join(apiRoot, 'prisma', fallbackDbName) : null
if (fallbackDbName) process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['VERIFICATION_DATABASE_TARGET'] ??= 'isolated'
assertIsolatedVerificationDatabase()
if (fallbackDbName) prepareFallbackDb()

let passed = 0
function pass(m: string) { passed += 1; console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); cleanupFallbackDb(); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}
function errStatus(e: unknown): number | undefined {
  const ex = e as { getStatus?: () => number }
  return typeof ex.getStatus === 'function' ? ex.getStatus() : undefined
}

async function expectCode(label: string, code: string, fn: () => Promise<unknown>, status?: number): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望 ${code}，但调用成功了`)
  } catch (e) {
    const actual = errCode(e)
    if (actual !== code) fail(`${label} — 期望 ${code}，实际 ${actual ?? (e as Error).message}`)
    if (status !== undefined && errStatus(e) !== status) {
      fail(`${label} — 期望 HTTP ${status}，实际 ${errStatus(e) ?? 'unknown'}`)
    }
    pass(label)
  }
}

function guardNames(target: unknown): string[] {
  return ((Reflect.getMetadata(GUARDS_METADATA, target as object) ?? []) as Array<{ name: string }>).map((g) => g.name)
}

/** 与 main.ts 中全局管道同配置，用于真实校验 DTO（而不是只测 service）。 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: 'invalid', details: errors.length } }),
})
const dtoMeta = { type: 'body', metatype: CreateKioskFeedbackDto } as const
function through(body: unknown): Promise<CreateKioskFeedbackDto> {
  return pipe.transform(body, dtoMeta) as Promise<CreateKioskFeedbackDto>
}

async function main() {
  console.log('\n=== A3 S1 一体机匿名反馈提交面验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const kiosk = new KioskFeedbackService(prisma)
  const controller = new KioskFeedbackController(kiosk)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  // 每组用独立终端：限流按终端收敛，共用终端会让前一组的建单吃掉后一组的额度。
  const T = (k: string) => `term_kfb_${k}_${suffix}`
  const terminalIds = ['main', 'other', 'rate', 'ratehour', 'dedup', 'dedup2', 'concurrent'].map(T)
  const printTaskId = `ptask_kfb_${suffix}`
  const scanTaskId = `stask_kfb_${suffix}`
  const memberId = `eu_kfb_${suffix}`

  async function cleanup() {
    await prisma.feedbackTicket.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.feedbackTicket.deleteMany({ where: { endUserId: memberId } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { id: printTaskId } }).catch(() => undefined)
    await prisma.scanTask.deleteMany({ where: { id: scanTaskId } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: memberId } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } }).catch(() => undefined)
  }

  try {
    await cleanup()
    for (const id of terminalIds) {
      await prisma.terminal.create({
        data: {
          id,
          terminalCode: `TC-${id}`,
          agentToken: `token-${id}`,
          deviceFingerprint: `fp-${id}`,
          displayName: `匿名反馈验证终端 ${id}`,
        },
      })
    }
    await prisma.endUser.create({
      data: { id: memberId, phoneHash: `kfb-${suffix}`, phoneEnc: `kfb-enc-${suffix}`, nickname: '匿名反馈验证会员' },
    })
    // 任务归属：打印任务挂 main，扫描任务挂 other —— 用于交叉验证跨终端拒绝。
    await prisma.printTask.create({
      data: { id: printTaskId, terminalId: T('main'), fileUrl: 'sig://kfb', fileMd5: 'kfb', status: 'completed' },
    })
    await prisma.scanTask.create({
      data: {
        id: scanTaskId, terminalId: T('other'), scanType: 'document', status: 'completed',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    // ---------------------------------------------------------------- 1. 匿名可提交
    console.log('\n[1] 匿名可提交 / 鉴权边界')
    const memberGuards = guardNames(MemberFeedbackController)
    if (!memberGuards.includes(EndUserAuthGuard.name)) {
      fail('1a. 反向断言失效：会员端 /me/feedback 已经没有 EndUserAuthGuard —— 本任务禁止改动它')
    }
    pass('1a. 反向断言：会员端 /me/feedback 仍挂 EndUserAuthGuard（检测方法本身有效，且既有行为未被改动）')

    const kioskGuards = guardNames(KioskFeedbackController)
    const kioskMethodGuards = guardNames(KioskFeedbackController.prototype.submit)
    if (kioskGuards.length || kioskMethodGuards.length) {
      fail(`1b. 匿名端不应有任何 guard，实际: ${[...kioskGuards, ...kioskMethodGuards].join(',')}`)
    }
    pass('1b. 匿名端 /kiosk/feedback 类与方法上都没有 guard（免登录）')

    const first = await controller.submit(await through({
      terminalId: T('main'), issueCode: 'device_out_of_paper',
    }))
    const firstRow = await prisma.feedbackTicket.findUnique({ where: { id: first.data.ticketId } })
    if (!firstRow) fail('1c. 匿名提交未落库')
    if (firstRow.endUserId !== null) fail(`1c. 匿名工单不应有 endUserId，实际 ${firstRow.endUserId}`)
    if (firstRow.submitterType !== ANONYMOUS_KIOSK_SUBMITTER) fail(`1c. submitterType 错误：${firstRow.submitterType}`)
    if (firstRow.contactPhoneEnc !== null) fail('1c. 匿名工单不应有联系方式')
    pass('1c. 无任何登录态即可提交，落库为 endUserId=null / submitterType=anonymous_kiosk / 无联系方式')

    // 匿名工单不能通过会员列表读到（否则等于给匿名数据开了会员读口）。
    const memberList = await prisma.feedbackTicket.findMany({ where: { endUserId: memberId } })
    if (memberList.some((r) => r.id === first.data.ticketId)) fail('1d. 匿名工单出现在会员名下')
    pass('1d. 匿名工单不归属任何会员（会员列表查不到）')

    // ---------------------------------------------------------------- 2. 分类白名单
    console.log('\n[2] 封闭词表（分类白名单）')
    const okDto = await through({ terminalId: T('main'), issueCode: 'print_quality_defect' })
    if (okDto.issueCode !== 'print_quality_defect') fail('2a. 合法 issueCode 被管道改写')
    pass('2a. 反向断言：合法 issueCode 能通过真实 ValidationPipe（管道没有一律拒绝）')

    await expectCode('2b. 越界 issueCode（refund_now）被拒', 'VALIDATION_FAILED', () =>
      through({ terminalId: T('main'), issueCode: 'refund_now' }))
    await expectCode('2c. 任意字符串 issueCode 被拒', 'VALIDATION_FAILED', () =>
      through({ terminalId: T('main'), issueCode: '<script>alert(1)</script>' }))
    await expectCode('2d. 私带 category 想绕过映射被拒（forbidNonWhitelisted）', 'VALIDATION_FAILED', () =>
      through({ terminalId: T('main'), issueCode: 'other', category: 'recruiting' }))
    await expectCode('2e. 越界满意度被拒', 'VALIDATION_FAILED', () =>
      through({ terminalId: T('main'), satisfaction: 'excellent' }))
    await expectCode('2f. 既无 issueCode 也无满意度的空提交被拒', 'KIOSK_FEEDBACK_EMPTY', async () =>
      kiosk.submit(await through({ terminalId: T('main') })))

    const strayCategory = KIOSK_FEEDBACK_ISSUE_CODES
      .map((code) => KIOSK_FEEDBACK_ISSUE_MAP[code].category)
      .filter((c) => !(FEEDBACK_CATEGORIES as readonly string[]).includes(c))
    if (strayCategory.length) fail(`2g. issueCode 映射出了枚举外的 category: ${strayCategory.join(',')}`)
    pass(`2g. ${KIOSK_FEEDBACK_ISSUE_CODES.length} 个 issueCode 全部映射到既有 FEEDBACK_CATEGORIES 枚举内`)

    // ---------------------------------------------------------------- 3. PII 拒绝
    console.log('\n[3] 不收 PII / 文本清洗')
    const cleanText = ' 打印   出来的\t字发花，第二页\n最明显 '
    const cleanTicket = await kiosk.submit(await through({
      terminalId: T('main'), issueCode: 'print_quality_defect', content: cleanText,
    }))
    const cleanRow = await prisma.feedbackTicket.findUnique({ where: { id: cleanTicket.ticketId } })
    if (cleanRow?.content !== '打印 出来的 字发花，第二页 最明显') {
      fail(`3a. 干净文本清洗结果不符：${JSON.stringify(cleanRow?.content)}`)
    }
    pass('3a. 反向断言：干净文本被接受并入库（空白折叠 / 控制字符折空格，不是一律拒绝）')

    const piiCases: Array<[string, string]> = [
      ['手机号', '打不出来，我的号码是13812345678'],
      ['带分隔符手机号', '联系我 138-1234-5678'],
      ['带空格手机号', '联系 138 1234 5678 谢谢'],
      ['全角手机号', '电话１３８１２３４５６７８'],
      ['零宽切分手机号', '电话138​1234​5678'],
      ['18 位身份证', '身份证 11010519900307561X 打不出来'],
      ['15 位身份证', '证件号 110105900307561'],
      ['邮箱', '发我邮箱 zhangsan@example.com'],
      ['银行卡号', '扣款到 6222021234567890123'],
    ]
    for (const [name, content] of piiCases) {
      await expectCode(`3b. ${name} 被拒`, 'KIOSK_FEEDBACK_PII_REJECTED', async () =>
        kiosk.submit(await through({ terminalId: T('main'), issueCode: 'other', content })))
    }
    await expectCode('3c. 超长自由文本被拒（DTO 上限）', 'VALIDATION_FAILED', () =>
      through({ terminalId: T('main'), issueCode: 'other', content: '啊'.repeat(KIOSK_FEEDBACK_CONTENT_MAX + 1) }))
    await expectCode('3d. 合规红线文案被拒', 'FEEDBACK_COPY_FORBIDDEN', async () =>
      kiosk.submit(await through({ terminalId: T('main'), issueCode: 'other', content: '希望能帮我一键投递到这家企业' })))

    // PII 拒绝必须不回显原文片段（否则等于把 PII 反射回调用方 / 日志）。
    try {
      await kiosk.submit(await through({ terminalId: T('main'), issueCode: 'other', content: '号码13812345678' }))
      fail('3e. PII 未被拒')
    } catch (e) {
      const body = JSON.stringify((e as { getResponse: () => unknown }).getResponse())
      if (body.includes('13812345678')) fail(`3e. 错误响应回显了 PII 原文：${body}`)
      pass('3e. PII 拒绝的错误响应只回规则名，不回显原文')
    }

    // 提交路径不得把自由文本写进 stdout/stderr。
    const marker = `不打印这段文本${suffix}`
    const captured: string[] = []
    const realLog = console.log
    const realErr = console.error
    console.log = (...a: unknown[]) => { captured.push(a.join(' ')) }
    console.error = (...a: unknown[]) => { captured.push(a.join(' ')) }
    try {
      await kiosk.submit(await through({ terminalId: T('main'), issueCode: 'print_other', content: marker }))
    } finally {
      console.log = realLog
      console.error = realErr
    }
    if (captured.join('\n').includes(marker)) fail('3f. 提交路径把自由文本写进了日志')
    pass('3f. 提交路径不把自由文本写入 stdout/stderr')

    // ---------------------------------------------------------------- 4. 限流
    console.log('\n[4] 限流（按终端落库计数 + 按 IP 的 Throttle 元数据）')
    const shortWindow = KIOSK_FEEDBACK_RATE_LIMITS[0]
    const longWindow = KIOSK_FEEDBACK_RATE_LIMITS[1]
    for (let i = 0; i < shortWindow.max; i += 1) {
      await kiosk.submit(await through({
        terminalId: T('rate'), issueCode: 'other', content: `第 ${i} 条互不相同的现场问题描述`,
      }))
    }
    pass(`4a. 反向断言：额度内 ${shortWindow.max} 条全部放行（限流没有提前误伤）`)

    await expectCode(`4b. 第 ${shortWindow.max + 1} 条超额 → 429`, 'KIOSK_FEEDBACK_RATE_LIMITED', async () =>
      kiosk.submit(await through({ terminalId: T('rate'), issueCode: 'other', content: '超额的第六条描述' })), 429)

    const otherTerminalTicket = await kiosk.submit(await through({
      terminalId: T('other'), issueCode: 'other', content: '超额的第六条描述',
    }))
    if (!otherTerminalTicket.ticketId) fail('4c. 另一终端被误伤')
    pass('4c. 限流按终端收敛：同一内容换一台终端仍可提交（不是全局闸）')

    // 小时档：把 20 条挪到 10 分钟窗口之外、60 分钟窗口之内，短窗放行、长窗必须拦。
    const outsideShort = new Date(Date.now() - shortWindow.windowMs - 60_000)
    await prisma.feedbackTicket.createMany({
      data: Array.from({ length: longWindow.max }, (_, i) => ({
        id: `fb_hour_${suffix}_${i}`,
        endUserId: null,
        submitterType: ANONYMOUS_KIOSK_SUBMITTER,
        terminalId: T('ratehour'),
        category: 'general',
        content: '历史工单',
        createdAt: outsideShort,
        updatedAt: outsideShort,
      })),
    })
    const shortCount = await prisma.feedbackTicket.count({
      where: {
        terminalId: T('ratehour'),
        submitterType: ANONYMOUS_KIOSK_SUBMITTER,
        createdAt: { gte: new Date(Date.now() - shortWindow.windowMs) },
      },
    })
    if (shortCount !== 0) fail(`4d. 小时档用例构造失败：短窗内不应有历史工单，实际 ${shortCount}`)
    pass('4d. 反向断言：历史工单全部落在 10 分钟窗口之外（短窗计数为 0，因此下一条只可能被小时档拦下）')
    await expectCode('4e. 小时档独立生效 → 429', 'KIOSK_FEEDBACK_RATE_LIMITED', async () =>
      kiosk.submit(await through({ terminalId: T('ratehour'), issueCode: 'other', content: '小时档超额' })), 429)

    const throttleTtl = Reflect.getMetadata('THROTTLER:TTLdefault', KioskFeedbackController.prototype.submit)
    const throttleLimit = Reflect.getMetadata('THROTTLER:LIMITdefault', KioskFeedbackController.prototype.submit)
    if (throttleTtl !== 60_000 || throttleLimit !== 6) {
      fail(`4f. 按 IP 的 Throttle 元数据缺失或被改：ttl=${throttleTtl} limit=${throttleLimit}`)
    }
    pass('4f. 路由带 @Throttle 6 次/60 秒（按 IP 层，比全局默认 60 次/60 秒收紧 10 倍）')

    // 幂等命中不建行 → 不吃额度：额度已满的终端上重复提交老内容仍回原单。
    const before = await prisma.feedbackTicket.count({ where: { terminalId: T('rate') } })
    const repeat = await kiosk.submit(await through({
      terminalId: T('rate'), issueCode: 'other', content: '第 0 条互不相同的现场问题描述',
    }))
    const after = await prisma.feedbackTicket.count({ where: { terminalId: T('rate') } })
    if (!repeat.deduplicated || after !== before) fail(`4g. 幂等命中消耗了额度或建了新行：${before} → ${after}`)
    pass('4g. 幂等命中不建行、不吃额度（额度已满的终端上重复提交仍回原单而非 429）')

    // ---------------------------------------------------------------- 5. 跨终端任务 ID
    console.log('\n[5] 关联任务归属')
    const owned = await kiosk.submit(await through({
      terminalId: T('main'), issueCode: 'print_incomplete_or_jam', relatedPrintTaskId: printTaskId,
      content: '这一单卡住了没出完',
    }))
    if (!owned.ticketId) fail('5a. 本终端打印任务关联失败')
    pass('5a. 反向断言：属于本终端的打印任务可以关联（校验没有一律拒绝）')

    await expectCode('5b. 跨终端打印任务 ID 被拒', 'KIOSK_FEEDBACK_PRINT_TASK_INVALID', async () =>
      kiosk.submit(await through({
        terminalId: T('other'), issueCode: 'print_other', relatedPrintTaskId: printTaskId,
      })))

    const ownedScan = await kiosk.submit(await through({
      terminalId: T('other'), issueCode: 'scan_issue', relatedScanTaskId: scanTaskId, content: '扫描件缺了一页',
    }))
    if (!ownedScan.ticketId) fail('5c. 本终端扫描任务关联失败')
    pass('5c. 反向断言：属于本终端的扫描任务可以关联')

    await expectCode('5d. 跨终端扫描任务 ID 被拒', 'KIOSK_FEEDBACK_SCAN_TASK_INVALID', async () =>
      kiosk.submit(await through({
        terminalId: T('main'), issueCode: 'scan_issue', relatedScanTaskId: scanTaskId,
      })))

    // 不存在的任务与跨终端任务返回同一错误码：否则匿名面变成跨终端任务存在性探测器。
    await expectCode('5e. 不存在的打印任务 ID 被拒（与跨终端同码，不构成存在性探测）',
      'KIOSK_FEEDBACK_PRINT_TASK_INVALID', async () =>
        kiosk.submit(await through({
          terminalId: T('main'), issueCode: 'print_other', relatedPrintTaskId: `ptask_missing_${suffix}`,
        })))
    await expectCode('5f. 不存在的终端被拒', 'KIOSK_FEEDBACK_TERMINAL_INVALID', async () =>
      kiosk.submit(await through({ terminalId: `term_missing_${suffix}`, issueCode: 'other' })))

    // ---------------------------------------------------------------- 6. 幂等
    console.log('\n[6] 幂等')
    const dedupBody = { terminalId: T('dedup'), issueCode: 'billing_issue' as const, content: '这次扣费比预估的多' }
    const a1 = await kiosk.submit(await through(dedupBody))
    const differentContent = await kiosk.submit(await through({ ...dedupBody, content: '另一条完全不同的费用问题' }))
    if (differentContent.ticketId === a1.ticketId || differentContent.deduplicated) {
      fail('6a. 不同内容被误判为重复（幂等过度收敛）')
    }
    pass('6a. 反向断言：同终端不同内容分别建单（幂等没有把所有提交都吞掉）')

    const a2 = await kiosk.submit(await through(dedupBody))
    if (a2.ticketId !== a1.ticketId || !a2.deduplicated) fail(`6b. 重复提交未命中幂等：${a1.ticketId} vs ${a2.ticketId}`)
    const dedupRows = await prisma.feedbackTicket.count({ where: { terminalId: T('dedup'), category: 'general' } })
    if (dedupRows !== 2) fail(`6b. dedup 终端应只有 2 条工单（两种内容各一条），实际 ${dedupRows}`)
    pass('6b. 短时间内重复提交同一内容 → 返回同一工单，不制造重复工单')

    const crossTerminal = await kiosk.submit(await through({ ...dedupBody, terminalId: T('dedup2') }))
    if (crossTerminal.ticketId === a1.ticketId) fail('6c. 幂等键未按终端隔离')
    pass('6c. 幂等按终端隔离：另一台终端的同样内容独立建单')

    const concurrentBody = { terminalId: T('concurrent'), issueCode: 'upload_issue' as const, content: '上传一直转圈' }
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, async () => kiosk.submit(await through(concurrentBody))),
    )
    const rejected = results.filter((r) => r.status === 'rejected')
    if (rejected.length) fail(`6d. 并发提交出现异常：${(rejected[0] as PromiseRejectedResult).reason}`)
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ ticketId: string }>).value.ticketId))
    const concurrentRows = await prisma.feedbackTicket.count({ where: { terminalId: T('concurrent') } })
    if (ids.size !== 1 || concurrentRows !== 1) {
      fail(`6d. 并发重复提交未收敛：ticketIds=${ids.size} rows=${concurrentRows}`)
    }
    pass('6d. 并发 5 次相同提交由 dedupKey UNIQUE 收敛成 1 条工单')
  } finally {
    await prisma.feedbackTicket.deleteMany({ where: { id: { startsWith: `fb_hour_${suffix}` } } }).catch(() => undefined)
    await cleanup()
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }

  console.log(`\nALL PASS (${passed})`)
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  cleanupFallbackDb()
  process.exit(1)
})

function cleanupFallbackDb(): void {
  if (!fallbackDbName) return
  for (const s of ['', '-wal', '-shm']) {
    rmSync(path.join(apiRoot, 'prisma', `${fallbackDbName}${s}`), { force: true })
  }
}

function prepareFallbackDb(): void {
  if (!fallbackDbPath) return
  try {
    closeSync(openSync(fallbackDbPath, 'a'))
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push'], { cwd: apiRoot, stdio: 'pipe' })
  } catch (error) {
    const details = error as { stdout?: Buffer; stderr?: Buffer }
    console.error(details.stdout?.toString() ?? '')
    console.error(details.stderr?.toString() ?? '')
    cleanupFallbackDb()
    throw error
  }
}
