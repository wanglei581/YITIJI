/**
 * 小程序云打印 M2 第一片：Order-only → 到机认领 → 现场支付 → 唯一 PrintTask。
 * 使用一次性 SQLite 数据库与真实服务类，绝不连接生产。
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { validateSync } from 'class-validator'
import { AuditService } from '../src/audit/audit.service'
import { PICKUP_CODE_LENGTH, PICKUP_CODE_PATTERN, randomPickupCode } from '../src/common/pickup-code'
import type { RedisService } from '../src/common/redis/redis.service'
import { ClaimPickupDto } from '../src/print-jobs/dto/claim-pickup.dto'
import { PICKUP_LOCKOUT_FAILURE_THRESHOLD } from '../src/print-jobs/pickup-claim-lockout'
import { MemberPrintOrderCreateService } from '../src/member-print-orders/member-print-order-create.service'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PickupOrderService } from '../src/print-jobs/pickup-order.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { setPrintScanCapabilityModeForTest, TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '../..')
const dbName = `verify-miniapp-cloud-print-${randomUUID().slice(0, 8)}.db`
// Prisma SQLite schema-engine 在包含中文字符的仓库绝对路径上会失败；隔离库放系统临时目录。
const dbPath = path.join('/tmp', dbName)
process.env['DATABASE_URL'] = `file:${dbPath}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['NODE_ENV'] = 'test'
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_SIGNING_SECRET'] = 'verify-file-signing-secret-0123456789abcdef'
process.env['PAYMENT_SESSION_SECRET'] = 'verify-payment-session-secret-0123456789abcdef'
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-secret-encryption-key-0123456789abcdef'

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }
function codeOf(error: unknown): string {
  const ex = error as { getResponse?: () => unknown; response?: unknown; message?: string }
  const response = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string }; message?: string } | undefined
  return response?.error?.code ?? response?.message ?? ex.message ?? 'UNKNOWN'
}
/**
 * 抓取一次调用的**完整对外响应形状**（HTTP 状态 + 错误码 + 文案）。
 *
 * 预言机断言必须比对这个结构，而不是「有没有抛错」—— 合并前后两条路径都抛，
 * 用「抛没抛」当判据的话，合并与否都会绿。
 */
async function captureHttpError(
  action: () => Promise<unknown>,
): Promise<{ thrown: boolean; status: number | null; code: string | null; message: string | null }> {
  try {
    await action()
    return { thrown: false, status: null, code: null, message: null }
  } catch (error) {
    const ex = error as {
      getStatus?: () => number
      getResponse?: () => unknown
    }
    const status = typeof ex.getStatus === 'function' ? ex.getStatus() : null
    const body = typeof ex.getResponse === 'function' ? ex.getResponse() : null
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error
    return { thrown: true, status, code: err?.code ?? null, message: err?.message ?? null }
  }
}

async function expectCode(action: () => Promise<unknown>, expected: string, label: string): Promise<void> {
  try { await action(); fail(`${label}: expected ${expected}`) }
  catch (error) {
    const actual = codeOf(error)
    if (!actual.includes(expected)) fail(`${label}: expected ${expected}, got ${actual}`)
    pass(label)
  }
}
/**
 * 最小 Redis 替身：只实现锁定模块用到的 4 个命令（get / setEx / incrWithTtl / del）。
 *
 * 为什么用替身而不是连真 Redis：本脚本此前**整条链路不经过 Redis**
 * （见 `common/redis/redis-degradation.ts` 的 `'terminal-agent-print': 'unaffected'` 声明），
 * 为了测锁定而给它引入一个外部服务依赖，会让这条声明变得难以维持，
 * 也让脚本在没有 Redis 的开发机上跑不了。
 * 替身覆盖的是锁定的**状态机语义**（阈值 / 计数清零 / 锁存在性），
 * 而「生产上注入的是真 RedisService」由 verify-backend-p0-contracts.mjs 静态断言。
 * `failing` 模式用于验证 Redis 故障时**放行**（fail-open）。
 */
class FakeRedis {
  private store = new Map<string, string>()
  failing = false

  private guard(): void {
    if (this.failing) throw new Error('FakeRedis: simulated outage')
  }
  async get(key: string): Promise<string | null> {
    this.guard()
    return this.store.get(key) ?? null
  }
  async setEx(key: string, _ttlSeconds: number, value: string): Promise<void> {
    this.guard()
    this.store.set(key, value)
  }
  async del(key: string): Promise<number> {
    this.guard()
    return this.store.delete(key) ? 1 : 0
  }
  async incrWithTtl(key: string, _ttlSeconds: number): Promise<number> {
    this.guard()
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return next
  }
  /** 测试辅助：直接清掉全部状态，等价于窗口/锁自然过期。 */
  reset(): void {
    this.store.clear()
  }
}

function cleanupDb(): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
}
function prepareDb(): void {
  assertIsolatedVerificationDatabase()
  // 本机 Prisma schema-engine 的 db push 当前只返回无细节错误；专项验证改为按顺序执行
  // 仓库正式 SQLite migrations，这也同时验证新增 migration 能从空库完整升级。
  const migrationsRoot = path.join(apiRoot, 'prisma', 'migrations')
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(migrationsRoot, entry.name, 'migration.sql'))
    .sort()
  for (const migration of migrations) {
    execFileSync('sqlite3', [dbPath], { input: readFileSync(migration), stdio: ['pipe', 'pipe', 'pipe'] })
  }
}

function assertCrossSurfaceWiring(): void {
  const memberController = readFileSync(
    path.join(apiRoot, 'src/member-print-orders/member-print-orders.controller.ts'),
    'utf8',
  )
  const pickupController = readFileSync(path.join(apiRoot, 'src/print-jobs/print-jobs.controller.ts'), 'utf8')
  const miniappApi = readFileSync(path.join(repoRoot, 'apps/miniapp/utils/api.js'), 'utf8')
  const miniappPay = readFileSync(path.join(repoRoot, 'apps/miniapp/pages/print-pay/print-pay.js'), 'utf8')
  const kioskClaim = readFileSync(path.join(repoRoot, 'apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx'), 'utf8')
  const kioskCashier = readFileSync(path.join(repoRoot, 'apps/kiosk/src/pages/print/PrintCashierPage.tsx'), 'utf8')
  const kioskPaymentApi = readFileSync(path.join(repoRoot, 'apps/kiosk/src/services/print/paymentApi.ts'), 'utf8')

  const checks: Array<[boolean, string]> = [
    [memberController.includes("@Controller('me/print-orders')") && memberController.includes('@Post()'), '会员 Order-only 建单路由已注册'],
    [pickupController.includes("@Post('claim-pickup')") && pickupController.includes("@Post(':orderId/release')"), '到机认领/release 路由已注册'],
    [miniappApi.includes("request('/me/print-orders', { method: 'POST'") && miniappPay.includes('api.createCloudPrintOrder'), '小程序确实调用 Order-only 建单'],
    [kioskClaim.includes("result.released ? '/print/progress' : '/print/cashier'") && kioskClaim.includes("'x-terminal-id': terminalId"), 'Kiosk 核验后按释放状态进收银或进度'],
    [kioskCashier.includes('releasePickupOrder') && kioskCashier.includes('if (!state.taskId && orderId && paymentSessionToken)'), 'Kiosk 付款后才触发 Order-only release'],
    [kioskPaymentApi.includes("/print/jobs/${encodeURIComponent(input.orderId)}/release") && kioskPaymentApi.includes("'x-terminal-id': terminalId"), 'Kiosk release 请求携带终端与支付会话绑定'],
  ]
  for (const [ok, label] of checks) {
    if (!ok) fail(`跨端契约断裂: ${label}`)
    pass(label)
  }
}

/**
 * 取件码不变量：**签发出来的码，必须恒被受理端接受**。
 *
 * 这是本仓「PICKUP_CODE_LEN 重复定义两份」那个 bug 唯一能被自动发现的形态。
 * 两份长度不同步时，typecheck 全绿、lint 全绿、页面全绿 —— 只有真的发一枚码、
 * 再喂给真正的 DTO 校验器，才会看见「按 6 位发、按 10 位收」。
 *
 * 刻意不连库：这条不变量与数据无关，应该在最前面最快失败。
 */
function assertPickupCodeSpecInvariant(): void {
  const SAMPLES = 500
  const seen = new Set<string>()
  const digitsSeen = new Set<string>()

  for (let i = 0; i < SAMPLES; i += 1) {
    const code = randomPickupCode()

    if (code.length !== PICKUP_CODE_LENGTH) {
      fail(`签发码长度应为 ${PICKUP_CODE_LENGTH}，实际 ${code.length}（${JSON.stringify(code)}）`)
    }
    if (!PICKUP_CODE_PATTERN.test(code)) {
      fail(`签发码不符合当前格式 ${PICKUP_CODE_PATTERN}：${JSON.stringify(code)}`)
    }

    // ★ 核心不变量：把真码喂给真正的受理校验器（不是复刻一遍正则）。
    const errors = validateSync(Object.assign(new ClaimPickupDto(), { code }))
    if (errors.length > 0) {
      fail(
        `签发端与受理端长度/字符集不一致：randomPickupCode() 产出 ${JSON.stringify(code)}` +
          `（${code.length} 位），但 ClaimPickupDto 拒绝了它 —— ` +
          `${JSON.stringify(errors.map((e) => e.constraints))}。` +
          '这正是 PICKUP_CODE_LEN 被复制成两份时的事故形态：在途取件码全部作废。',
      )
    }

    seen.add(code)
    for (const ch of code) digitsSeen.add(ch)
  }
  pass(`签发 ${SAMPLES} 枚码，全部为 ${PICKUP_CODE_LENGTH} 位纯数字且全部被 ClaimPickupDto 受理`)

  // 随机性起码要是随机的：500 枚 6 位码全命中 10 个数字的概率 ≈ 1；
  // 若字符集被写错成子集（或退化成常量），这里立刻红。
  if (digitsSeen.size !== 10) {
    fail(`签发码只用到 ${digitsSeen.size} 个不同数字，字符集疑似写错：${[...digitsSeen].sort().join('')}`)
  }
  if (seen.size < SAMPLES * 0.9) {
    fail(`${SAMPLES} 次签发只得到 ${seen.size} 个不同码，随机源疑似退化`)
  }
  pass('签发码覆盖全部 10 个数字且无明显重复退化（随机源为 crypto.randomBytes + 拒绝采样）')

  // 存量防线：10 位旧码必须仍被受理，否则已付费用户在过渡期取不到自己的文件。
  const legacySample = 'AB2C7M9P3K'
  if (validateSync(Object.assign(new ClaimPickupDto(), { code: legacySample })).length > 0) {
    fail(`存量 10 位取件码 ${legacySample} 被拒 —— 已付费用户的在途订单将无法认领`)
  }
  pass('存量 10 位取件码仍被受理（过渡期不得让已付费用户取不到件）')

  // 受理面不许被顺手放宽成「什么都收」。
  // 6/7/9 位在列表里是刻意的：方案 A 把长度从 6 提到 8，若有人改回 6 位或写错成 7/9，
  // 这里必须红 —— 不能只靠「8 位能过」证明长度对。
  for (const bad of [
    '123456', '1234567', '123456789', '', 'ABCDEFGH', '1234567A',
    'AB2C7M9P3', 'AB2C7M9P3KL', 'AB2C7M9P30', '12345678 ', ' 12345678',
  ]) {
    if (validateSync(Object.assign(new ClaimPickupDto(), { code: bad })).length === 0) {
      fail(`受理面过宽：${JSON.stringify(bad)} 不应通过 ClaimPickupDto 校验`)
    }
  }
  pass('错长度（含 6/7/9 位）/错字符集的码一律被 ClaimPickupDto 拒绝（受理面未被放宽）')

  // 限流是 6 位码安全论证的一部分，不是性能参数。被调宽就必须在这里红。
  const pickupController = readFileSync(path.join(apiRoot, 'src/print-jobs/print-jobs.controller.ts'), 'utf8')
  const claimThrottle = /@Post\('claim-pickup'\)[\s\S]{0,200}?@Throttle\(\{ default: \{ ttl: 60_000, limit: (\d+) \} \}\)/.exec(
    pickupController,
  )
  if (!claimThrottle || Number(claimThrottle[1]) > 20) {
    fail(
      `claim-pickup 限流必须 ≤ 20 次/分钟（实测: ${claimThrottle?.[1] ?? '未找到 @Throttle'}）。` +
        '限流是 8 位码安全论证的组成部分（8 位 + 7 天单靠限流命中率已约 50.6%，靠按终端锁定压到约 1.4%）。放宽它等于削弱码长。',
    )
  }
  pass(`claim-pickup 限流仍为 ${claimThrottle[1]} 次/分钟（8 位码安全论证的组成部分，未被放宽）`)
}

async function main(): Promise<void> {
  console.log('\n=== 小程序云打印 M2 第一片专项验证 ===')
  assertPickupCodeSpecInvariant()
  assertCrossSurfaceWiring()
  cleanupDb()
  prepareDb()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const quote = new OrderQuoteService(new PrintPageCountService(prisma, storage), new PricingService(prisma))
  const memberOrders = new MemberPrintOrderCreateService(prisma, quote, capabilities, orderStatus, audit)
  const redis = new FakeRedis()
  const pickup = new PickupOrderService(prisma, capabilities, audit, redis as unknown as RedisService)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userId = `eu_m2_${suffix}`
  const terminalId = `terminal_m2_${suffix}`
  const otherTerminalId = `terminal_m2_other_${suffix}`
  const fileId = `file_m2_${suffix}`
  const pendingPiiFileId = `file_m2_pii_${suffix}`
  const storageKeys: string[] = []

  async function seedTerminal(id: string, code: string): Promise<void> {
    await prisma.terminal.create({
      data: { id, terminalCode: code, agentToken: `token-${id}`, deviceFingerprint: `fp-${id}`, displayName: `终端 ${code}`, locationLabel: '验证点' },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId: id, status: 'online', localTaskDatabaseAvailable: true, createdAt: new Date() },
    })
    await prisma.terminalCapability.create({
      data: { terminalId: id, capabilityKey: 'document_print', status: 'available' },
    })
  }
  async function seedFile(id: string, label: string, piiAction: 'keep' | 'pending', expiresInMs = 30 * 60 * 60 * 1000): Promise<void> {
    const storageKey = `verify/miniapp-m2/${id}.pdf`
    const pdf = buildRealPdf(2)
    await storage.putObject(storageKey, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    storageKeys.push(storageKey)
    await prisma.fileObject.create({
      data: {
        id, storageKey, bucket: LOCAL_BUCKET_SENTINEL, region: 'local', filename: `${label}.pdf`, mimeType: 'application/pdf',
        sizeBytes: pdf.length, sha256: 'a'.repeat(64), endUserId: userId, ownerType: 'user', ownerId: userId,
        purpose: 'print_doc', status: 'active', expiresAt: new Date(Date.now() + expiresInMs),
      },
    })
    const task = await prisma.documentProcessTask.create({
      data: { kind: 'pii_scan', status: 'completed', requesterMode: 'member', sourceFileId: id, endUserId: userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    })
    await prisma.piiFinding.create({ data: { taskId: task.id, type: 'phone', label: '手机号', action: piiAction } })
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await prisma.endUser.create({ data: { id: userId, phoneHash: `hash-${userId}`, phoneEnc: `enc-${userId}` } })
    await seedTerminal(terminalId, `M2-${suffix}`)
    await seedTerminal(otherTerminalId, `M2-O-${suffix}`)
    await seedDevDefaultPriceConfig(prisma)
    await seedFile(fileId, '两页简历', 'keep')
    await seedFile(pendingPiiFileId, '未确认隐私', 'pending')
    pass('隔离数据库、在线终端、真实两页 PDF、价目与隐私夹具已建立')

    await expectCode(
      () => memberOrders.create(userId, { fileId: pendingPiiFileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' }),
      'PRINT_PII_DECISIONS_REQUIRED',
      '隐私命中未确认时拒绝建单',
    )

    const created = await memberOrders.create(userId, { fileId, terminalId, copies: 2, colorMode: 'black_white', duplex: 'simplex' })
    const stored = await prisma.order.findUnique({ where: { id: created.id } })
    const tasksBeforeClaim = await prisma.printTask.count({ where: { endUserId: userId } })
    if (!stored || tasksBeforeClaim !== 0 || stored.printTaskId || stored.pickupStatus !== 'pending' || stored.payStatus !== 'unpaid') {
      fail('建单阶段必须只有 Order，不能提前创建 PrintTask')
    }
    // 长度断言按新规格更新为 6，**不是删除**：它守的是「实际建单发出来的码就是规格里那个长度」，
    // 与 assertPickupCodeSpecInvariant 里的纯函数断言互补（那条守生成↔受理，这条守落库路径）。
    if (
      !created.pickupCode ||
      created.pickupCode.length !== PICKUP_CODE_LENGTH ||
      !PICKUP_CODE_PATTERN.test(created.pickupCode) ||
      stored.pickupCodeEnc === created.pickupCode ||
      stored.pickupCodeHash === created.pickupCode
    ) {
      fail(`到机码必须为 ${PICKUP_CODE_LENGTH} 位纯数字且数据库不得保存可查询明文（实际: ${JSON.stringify(created.pickupCode)}）`)
    }
    if (created.billablePages !== 2 || created.copies !== 2 || created.amountCents <= 0) fail('服务端页数/参数/报价快照不正确')

    // M1 渠道标注：小程序云打印建单必须落 channel='miniapp_cloud'。
    // 由服务端硬编、请求体不含该字段（小程序零改动）——若此断言失败，
    // 说明 member-print-order-create.service.ts 的 order.create 漏了 channel，
    // 后果是会员单与一体机单在库内不可区分。见 miniapp-console-sharing-2026-08 §六 T-M1。
    if (stored.channel !== 'miniapp_cloud') {
      fail(`小程序云打印建单 channel 应为 'miniapp_cloud'，实际: ${JSON.stringify(stored.channel)}`)
    }
    pass('小程序建单为 Order-only；页数与金额来自服务端；到机码仅 hash + 密文落库')

    const cancellable = await memberOrders.create(userId, { fileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' })
    await memberOrders.cancel(userId, cancellable.id, { reason: 'verify cancellation' })
    const cancelled = await prisma.order.findUnique({ where: { id: cancellable.id } })
    if (cancelled?.pickupStatus !== 'cancelled' || cancelled.payStatus !== 'closed' || cancelled.printTaskId) {
      fail('未付款 Order-only 取消后不得保留可用到机码或创建任务')
    }
    pass('未付款 Order-only 可取消且不会创建 PrintTask')

    // ── 预言机合并 ────────────────────────────────────────────────────────
    // 「码有效但不在这台机器」与「码根本不存在」必须**完全无法区分**。
    // 判据刻意不是「有没有抛错」（两者本来就都抛），而是逐字段比对真实响应：
    // HTTP 状态码、错误码、错误文案三者全等，才算不泄露「这枚码是否存在」。
    const mismatchShape = await captureHttpError(() => pickup.claim(created.pickupCode, otherTerminalId))
    const unknownShape = await captureHttpError(() => pickup.claim('00000000', otherTerminalId))
    if (mismatchShape.thrown === false || unknownShape.thrown === false) {
      fail('错终端 / 不存在的码都必须被拒绝')
    }
    if (JSON.stringify(mismatchShape) !== JSON.stringify(unknownShape)) {
      fail(
        '预言机未合并：「真码 + 错终端」与「不存在的码」响应不一致，攻击者据此可筛出真码。\n' +
          `  真码错终端: ${JSON.stringify(mismatchShape)}\n` +
          `  不存在的码: ${JSON.stringify(unknownShape)}`,
      )
    }
    if (mismatchShape.status !== 404 || mismatchShape.code !== 'PICKUP_CODE_INVALID') {
      fail(`合并后的拒绝响应应为 404/PICKUP_CODE_INVALID，实际 ${JSON.stringify(mismatchShape)}`)
    }
    pass(`错终端与不存在的码返回完全相同的响应 ${JSON.stringify(mismatchShape)}（预言机已合并）`)

    // 运营侧不能因为合并而变瞎：真码走错机器仍必须在服务端留痕，且带得出 orderId；
    // 而「码不存在」不留痕（否则枚举流量会被放大成审计写入）。
    const mismatchAudits = await prisma.auditLog.findMany({
      where: { action: 'print_order.pickup_claim_rejected', targetId: created.id },
    })
    if (mismatchAudits.length !== 1) {
      fail(`真码走错终端必须留下 1 条审计（现场排障靠它区分「走错机器」与「码输错」），实际 ${mismatchAudits.length} 条`)
    }
    const allRejectAudits = await prisma.auditLog.count({ where: { action: 'print_order.pickup_claim_rejected' } })
    if (allRejectAudits !== 1) {
      fail(`「码不存在」不得写审计（可被无限触发 → 审计表写放大），当前共 ${allRejectAudits} 条`)
    }
    pass('走错终端在服务端留痕且可定位到 orderId；不存在的码不写审计（运营不瞎、审计不被灌）')
    redis.reset() // 上面几次失败已计入锁定计数，清掉以免干扰后续用例
    const claimed = await pickup.claim(created.pickupCode, terminalId)
    if (claimed.released !== false || await prisma.printTask.count({ where: { endUserId: userId } }) !== 0) {
      fail('未付款认领不得创建 PrintTask')
    }
    const claimedAgain = await pickup.claim(created.pickupCode, terminalId)
    if (claimedAgain.released !== false || claimedAgain.orderId !== created.id) fail('重复认领未保持同一订单')
    pass('同机认领幂等，未付款仍不创建打印任务')

    await expectCode(
      () => pickup.release(created.id, terminalId, claimed.paymentSessionToken),
      'ORDER_NOT_PAID',
      '付款前 release 被服务端拒绝',
    )
    await orderStatus.markPaid(created.id, { paymentSource: 'offline', operatorId: 'verify-kiosk' })
    const released = await pickup.release(created.id, terminalId, claimed.paymentSessionToken)
    const releasedAgain = await pickup.release(created.id, terminalId, claimed.paymentSessionToken)
    const printTasks = await prisma.printTask.findMany({ where: { endUserId: userId } })
    if (printTasks.length !== 1 || released.taskId !== releasedAgain.taskId || released.taskId !== printTasks[0]?.id) {
      fail('付款后 release 必须只创建一个 PrintTask，旧 token 重试也必须返回同一任务')
    }
    const finalOrder = await prisma.order.findUnique({ where: { id: created.id } })
    if (finalOrder?.pickupStatus !== 'used' || finalOrder.printTaskId !== released.taskId || printTasks[0]?.status !== 'pending') {
      fail('释放后的订单/任务状态不一致')
    }
    pass('现场付款后原子释放唯一 PrintTask；响应丢失场景用旧 token 重试仍幂等')

    const concurrent = await memberOrders.create(userId, { fileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' })
    const concurrentClaim = await pickup.claim(concurrent.pickupCode, terminalId)
    await orderStatus.markPaid(concurrent.id, { paymentSource: 'offline', operatorId: 'verify-kiosk' })
    const races = await Promise.allSettled([
      pickup.release(concurrent.id, terminalId, concurrentClaim.paymentSessionToken),
      pickup.release(concurrent.id, terminalId, concurrentClaim.paymentSessionToken),
    ])
    const fulfilled = races.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<PickupOrderService['release']>>> => item.status === 'fulfilled')
    if (fulfilled.length === 0) fail('并发 release 至少应有一个请求成功')
    const concurrentRetry = await pickup.release(concurrent.id, terminalId, concurrentClaim.paymentSessionToken)
    const concurrentTasks = await prisma.printTask.findMany({ where: { endUserId: userId, id: concurrentRetry.taskId } })
    const concurrentOrder = await prisma.order.findUnique({ where: { id: concurrent.id } })
    if (concurrentTasks.length !== 1 || concurrentOrder?.printTaskId !== concurrentRetry.taskId) {
      fail('并发 release 后必须仍只有一个订单绑定任务')
    }
    if (fulfilled.some((item) => item.value.taskId !== concurrentRetry.taskId)) fail('并发成功响应返回了不同任务')
    pass('并发 release 经 CAS 收敛到唯一 PrintTask，失败请求可安全重试')

    const expiringFileId = `file_m2_exp_${suffix}`
    await seedFile(expiringFileId, '短期文件', 'keep', 60 * 60 * 1000)
    const expiring = await memberOrders.create(userId, { fileId: expiringFileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' })
    const expiringOrder = await prisma.order.findUnique({ where: { id: expiring.id } })
    if (!expiringOrder?.pickupCodeExpiresAt || expiringOrder.pickupCodeExpiresAt.getTime() > Date.now() + 61 * 60 * 1000) {
      fail('到机码有效期不得超过源文件有效期')
    }
    await prisma.order.update({ where: { id: expiring.id }, data: { pickupCodeExpiresAt: new Date(Date.now() - 1000) } })
    await expectCode(() => pickup.claim(expiring.pickupCode, terminalId), 'PICKUP_CODE_EXPIRED', '过期到机码拒绝认领')
    if (await prisma.printTask.count({ where: { endUserId: userId } }) !== 2) fail('过期订单不得产生额外打印任务')
    pass('文件 TTL 收紧到机码 TTL，过期订单不会释放任务')
    redis.reset()

    // ── §9 不伪造能力：对外的有效期必须是**真实生效值**，不是 PICKUP_TTL_MS ──
    // 有效期上限已改为 7 天，但落库值是 min(7 天, 文件过期时间)。上面那个 1 小时
    // 文件的订单，真实有效期就是 1 小时。若哪天有人「为了让 7 天生效」去掉夹取，
    // 或前端改成按常量算倒计时，用户就会拿到「码还在、文件已被清理」的假承诺。
    const expiringView = (await memberOrders.listCloud(userId))
      .find((row) => row.id === expiring.id) as { pickupCodeExpiresAt: string | null } | undefined
    const freshExpiring = await prisma.order.findUnique({ where: { id: expiring.id } })
    if (!expiringView) fail('会员订单列表里应能查到该订单')
    if (expiringView.pickupCodeExpiresAt !== (freshExpiring?.pickupCodeExpiresAt?.toISOString() ?? null)) {
      fail(
        '对外返回的取件码有效期与落库值不一致 —— 界面会显示一个并不成立的时间。\n' +
          `  视图: ${expiringView.pickupCodeExpiresAt}\n  落库: ${freshExpiring?.pickupCodeExpiresAt?.toISOString() ?? null}`,
      )
    }
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    const mainOrder = await prisma.order.findUnique({ where: { id: created.id } })
    const mainTtlMs = (mainOrder?.pickupCodeExpiresAt?.getTime() ?? 0) - mainOrder!.createdAt.getTime()
    if (mainTtlMs >= sevenDaysMs) {
      fail(
        `源文件 30 小时后过期，取件码有效期却达到了 ${Math.round(mainTtlMs / 3600000)} 小时 —— ` +
          'min(TTL, file.expiresAt) 夹取失效，会产生指向已清理文件的取件码',
      )
    }
    pass(`对外有效期 == 落库有效期，且被源文件夹取（本单实际 ${Math.round(mainTtlMs / 3600000)}h，远小于 7 天上限）`)

    // ── 按终端失败锁定 ────────────────────────────────────────────────────
    redis.reset()
    for (let i = 0; i < PICKUP_LOCKOUT_FAILURE_THRESHOLD - 1; i += 1) {
      await captureHttpError(() => pickup.claim('00000000', terminalId))
    }
    // 阈值前一次：仍然按正常拒绝处理，不能提前锁。
    const beforeLock = await captureHttpError(() => pickup.claim('00000001', terminalId))
    if (beforeLock.code !== 'PICKUP_CODE_INVALID') {
      fail(`第 ${PICKUP_LOCKOUT_FAILURE_THRESHOLD} 次失败前不应锁定，实际 ${JSON.stringify(beforeLock)}`)
    }
    const afterLock = await captureHttpError(() => pickup.claim('00000002', terminalId))
    if (afterLock.code !== 'PICKUP_CLAIM_LOCKED') {
      fail(`达到 ${PICKUP_LOCKOUT_FAILURE_THRESHOLD} 次失败后必须锁定该终端，实际 ${JSON.stringify(afterLock)}`)
    }
    // 锁定必须**按终端**：另一台机器不受牵连（按 IP 就做不到这一点）。
    const otherStillOpen = await captureHttpError(() => pickup.claim('00000003', otherTerminalId))
    if (otherStillOpen.code !== 'PICKUP_CODE_INVALID') {
      fail(`锁定不得外溢到其它终端，otherTerminal 实际 ${JSON.stringify(otherStillOpen)}`)
    }
    pass(`失败 ${PICKUP_LOCKOUT_FAILURE_THRESHOLD} 次后锁定本终端认领，且不影响其它终端`)

    // 成功认领清零计数：这是「正常用户手误不受影响」的实现手段，必须真的生效。
    //
    // ⚠️ 计数位置必须算准，否则这条断言是空的（第一版就踩了）：
    // 第 THRESHOLD 次失败会**置锁但仍返回 INVALID**（锁在下一次请求入口才生效）。
    // 所以「9 次失败 + 成功 + 再 1 次失败」两种实现都返回 INVALID，判别不出来。
    // 这里刻意在成功之后再失败**两次**：
    //   - 清零生效 → 计数 1、2，两次都是 INVALID；
    //   - 清零失效 → 计数 10（置锁）、11（被锁拦下）→ 第二次是 PICKUP_CLAIM_LOCKED。
    redis.reset()
    for (let i = 0; i < PICKUP_LOCKOUT_FAILURE_THRESHOLD - 1; i += 1) {
      await captureHttpError(() => pickup.claim('00000000', terminalId))
    }
    await pickup.claim(created.pickupCode, terminalId) // 真实用户成功一次
    await captureHttpError(() => pickup.claim('00000004', terminalId))
    const afterSuccess = await captureHttpError(() => pickup.claim('00000005', terminalId))
    if (afterSuccess.code !== 'PICKUP_CODE_INVALID') {
      fail(`成功认领应清零失败计数，否则繁忙机器会被零散手误累积锁死；实际 ${JSON.stringify(afterSuccess)}`)
    }
    pass('成功认领清零失败计数（繁忙终端不会被零散手误累积锁死）')

    // Redis 故障时放行：`REDIS_DEGRADED_IMPACT` 里 'terminal-agent-print': 'unaffected'
    // 是一条被门禁实际发请求核对的声明；锁定若在 Redis 挂掉时改为拒绝，那句话就成了假话，
    // 且所有人都取不到已付费的文件。
    redis.reset()
    redis.failing = true
    const degraded = await captureHttpError(() => pickup.claim('00000005', terminalId))
    if (degraded.code !== 'PICKUP_CODE_INVALID') {
      fail(`Redis 不可用时锁定必须放行（fail-open），实际 ${JSON.stringify(degraded)}`)
    }
    const degradedReal = await pickup.claim(created.pickupCode, terminalId)
    if (degradedReal.orderId !== created.id) fail('Redis 不可用时真实取件码仍必须能认领')
    redis.failing = false
    redis.reset()
    pass('Redis 不可用时锁定 fail-open，真实取件码仍可认领（不把纵深防线变成单点故障）')

  } finally {
    setPrintScanCapabilityModeForTest(null)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: (await prisma.order.findMany({ where: { endUserId: userId }, select: { id: true } })).map((row) => row.id) } } })
    await prisma.order.deleteMany({ where: { endUserId: userId } })
    await prisma.piiFinding.deleteMany({ where: { task: { endUserId: userId } } })
    await prisma.documentProcessTask.deleteMany({ where: { endUserId: userId } })
    await prisma.printTask.deleteMany({ where: { endUserId: userId } })
    await prisma.fileObject.deleteMany({ where: { endUserId: userId } })
    await prisma.endUser.deleteMany({ where: { id: userId } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [terminalId, otherTerminalId] } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalId, otherTerminalId] } } })
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
    for (const key of storageKeys) await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.onModuleDestroy()
    cleanupDb()
  }
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFAIL', error instanceof Error ? error.stack : error)
  cleanupDb()
  process.exit(1)
})
