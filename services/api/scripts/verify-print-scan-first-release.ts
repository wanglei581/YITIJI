import fs from 'fs'
import path from 'path'

const root = process.cwd()
let failed = 0

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function mustContain(source: string, needles: string[], message: string): void {
  const missing = needles.filter((needle) => !source.includes(needle))
  if (missing.length === 0) pass(message)
  else fail(`${message}，缺少: ${missing.join(' | ')}`)
}

function mustNotContain(source: string, needles: string[], message: string): void {
  const found = needles.filter((needle) => source.includes(needle))
  if (found.length === 0) pass(message)
  else fail(`${message}，不应包含: ${found.join(' | ')}`)
}

function mustNotMatch(source: string, pattern: RegExp, message: string): void {
  const match = source.match(pattern)
  if (!match) {
    pass(message)
    return
  }

  fail(`${message}，不应匹配: ${match[0].replace(/\s+/g, ' ').slice(0, 160)}`)
}

function assertNoOverclaim(source: string, message: string): void {
  const allowedQualifiers = /(不代表|不等于|不得|不能|禁止|尚未|未执行|未完成|未通过|待现场|待补齐|否|Not Passed Yet|PENDING|Blocked|阻塞|只代表|写成)/
  const patterns = [
    /Windows\s*真机[^。\n|]{0,40}(已通过|通过|完成|已完成|可上线|可商用)/,
    /真实扫描[^。\n|]{0,40}(已通过|通过|完成|已完成|可上线|可商用)/,
    /U\s*盘[^。\n|]{0,40}(已通过|通过|完成|已完成|可上线|可商用)/,
    /打印扫描[^。\n|]{0,40}(商用全闭环|生产完成|试运营完成|可上线|可商用)/,
    /小范围试运营[^。\n|]{0,40}(已通过|通过|完成|已完成|可进入|允许进入)/,
    /全部\s*Gate[^。\n|]{0,40}(已通过|通过|完成|已完成)/,
  ]
  const offenders = source
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + 1, line: line.trim() }))
    .filter(({ line }) => line.length > 0)
    .flatMap(({ index, line }) =>
      line
        .split(/[|。；;，,]/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => ({ index, line: segment })),
    )
    .filter(({ line }) => patterns.some((pattern) => pattern.test(line)) && !allowedQualifiers.test(line))

  if (offenders.length === 0) {
    pass(message)
    return
  }

  fail(`${message}，疑似过度宣称: ${offenders.map(({ index, line }) => `L${index}: ${line}`).join(' | ')}`)
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  if (startIndex < 0) return ''
  const endIndex = source.indexOf(end, startIndex + start.length)
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex)
}

function main(): void {
  console.log('\n=== print-scan first-release safety verification ===')

  const printJobsService = read('src/print-jobs/print-jobs.service.ts')
  const printJobsController = read('src/print-jobs/print-jobs.controller.ts')
  const printJobsVerify = read('scripts/verify-print-jobs.ts')
  const terminalsService = read('src/terminals/terminals.service.ts')
  const printJobsApi = read('../../apps/kiosk/src/services/print/printJobsApi.ts')
  const prismaSchema = read('prisma/schema.prisma')
  const adminTypes = read('../../apps/admin/src/services/api/types.ts')
  const adminTerminalsPage = read('../../apps/admin/src/routes/terminals/index.tsx')
  const adminPackageJson = read('../../apps/admin/package.json')
  const adminPrintOpsVerify = read('../../apps/admin/scripts/verify-admin-print-ops-visibility-ui.mjs')
  const ciWorkflow = read('../../.github/workflows/ci.yml')
  const acceptancePackage = read('../../docs/acceptance/print-scan-first-release-acceptance-package.md')
  const fieldRunbook = read('../../docs/acceptance/print-scan-field-execution-runbook.md')
  const currentProgress = read('../../docs/progress/current-progress.md')
  const nextTasks = read('../../docs/progress/next-tasks.md')

  mustContain(
    printJobsController,
    ["@Headers('x-terminal-id')", 'terminalId: terminalId ?? null'],
    'Kiosk create print job request must pass X-Terminal-Id into PrintJobsService',
  )

  mustContain(
    printJobsApi,
    ["'X-Terminal-Id': terminalId", 'VITE_TERMINAL_ID', 'missing terminal id'],
    'Kiosk print API must send configured terminal id and fail closed when missing',
  )

  mustContain(
    printJobsService,
    ['terminalId?: string | null', 'PRINT_TERMINAL_REQUIRED', 'terminalId: targetTerminalId'],
    'PrintJobsService.create must require and persist target terminalId',
  )

  const claimBlock = section(terminalsService, 'async claimTasks', '// ── 4. Patch task status')
  // 注：C5-3 起 findFirst 的 where 抽成 claimableWhere（叠加出纸门控），但仍按 terminalId + pending 收窄；
  // update 守卫（含 id + status + terminalId）保持不变，双重防越取仍在。
  mustContain(
    claimBlock,
    [
      'where: claimableWhere',
      "{ status: 'pending' as const, terminalId }",
      "where: { id: task.id, status: 'pending', terminalId }",
    ],
    'claim must filter pending tasks by terminalId',
  )
  // C5-3 出纸门控：门控开启时只领取「已 paid 或无 Order」的 pending 任务（付费未支付单不出纸）。
  mustContain(
    claimBlock,
    ['requirePaidBeforeClaim()', "order: { is: { payStatus: 'paid' } }", 'order: { is: null }'],
    'C5-3 出纸门控：claim 开启时仅领取已 paid 或无 Order 的 pending 任务',
  )
  mustContain(
    claimBlock,
    ['canTerminalClaimTasks(terminalId)', 'return []'],
    'claim must fail closed when latest heartbeat reports agent_degraded/local DB unavailable',
  )
  mustNotMatch(
    claimBlock,
    /data:\s*{[^}]*status:\s*'claimed'[^}]*terminalId\s*:/s,
    'claim must not overwrite target terminalId as claimedBy',
  )

  const statusBlock = section(terminalsService, 'async patchTaskStatus', 'async validateTerminalToken')
  mustContain(
    statusBlock,
    ['TASK_TERMINAL_MISSING', 'TASK_NOT_OWNED', 'await this.findAndValidate(terminalIdHeader, authHeader)'],
    'status patch must reject legacy unbound tasks and wrong terminal updates',
  )

  const resetBlock = section(terminalsService, 'private async resetExpiredClaims', 'private async seedPrintTask')
  mustNotContain(
    resetBlock,
    ['terminalId: null'],
    'expired claim reset must preserve target terminalId for same-terminal retry',
  )
  mustContain(
    resetBlock,
    ["status: 'claimed'", 'claimExpiry: { lt: now }', "status: 'pending'"],
    'claim TTL reset must keep lease recovery behavior',
  )
  mustContain(
    resetBlock,
    ["status: 'printing'", 'claimedAt: { lt: printingTimeout }', "status: 'pending'"],
    'stuck printing recovery must reset stale printing tasks for same-terminal retry',
  )

  mustContain(
    terminalsService,
    ['private async canTerminalClaimTasks', "latestHeartbeat.status !== 'agent_degraded'", 'latestHeartbeat.localTaskDatabaseAvailable !== false'],
    'backend must keep degraded Agent claim gate as defense-in-depth',
  )

  mustContain(
    printJobsVerify,
    [
      "process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'",
      'unpaidGateClaim.length === 0',
      "paidGateOrder?.payStatus === 'unpaid'",
      "orderStatus.markPaid(paidGateOrder.id, { paymentSource: 'offline'",
      'wrongPaidGateClaim.length === 0',
      'paidGateClaim.length === 1',
      "paidGateOrderAfterClaim?.payStatus === 'paid'",
      '恢复 online 后 paid 任务在 paid-before-claim=true 下可由原目标终端领取',
    ],
    'verify:print-jobs must guard recovery claim semantics under paid-before-claim',
  )

  const heartbeatBlock = section(terminalsService, 'async heartbeat', '// ── 3. Claim tasks')
  mustContain(
    heartbeatBlock,
    ['status: normalizeHeartbeatStatus(dto.status)', 'localTaskDatabaseAvailable: dto.localTaskDatabaseAvailable ?? null'],
    'heartbeat must persist Agent degraded/local DB availability into TerminalHeartbeat',
  )

  const adminTerminalBlock = section(terminalsService, 'async listTerminalsForAdmin', '/**\n   * Admin 终端归属下拉选项')
  mustContain(
    adminTerminalBlock,
    ['agentStatus: hb?.status ?? null', 'localTaskDatabaseAvailable: hb?.localTaskDatabaseAvailable ?? null'],
    'Admin terminal view must expose Agent degraded/local DB availability',
  )

  mustContain(
    adminTypes,
    ['agentStatus:', 'localTaskDatabaseAvailable: boolean | null'],
    'Admin terminal DTO must include Agent degraded/local DB availability fields',
  )

  mustContain(
    adminTerminalsPage,
    ['agent_degraded', '本地任务库不可用，已暂停领取打印任务'],
    'Admin terminals page must show degraded Agent state instead of healthy online',
  )

  mustContain(
    adminPackageJson,
    ['verify:admin-print-ops-visibility-ui'],
    'Admin package must expose print ops visibility UI verification',
  )

  mustContain(
    adminPrintOpsVerify,
    [
      "agentStatus === 'agent_degraded'",
      'localTaskDatabaseAvailable === false',
      '本地任务库不可用，已暂停领取打印任务',
      'orders page exposes failed status, error code, and status transition log',
      'order readonly service keeps file URL/hash out of Admin ops visibility payload',
      'orders page exposes only pending manual cancel/reassign handling',
      'Admin order actions adapter is limited to cancel/reassign endpoints',
    ],
    'Admin print ops visibility verify must guard degraded state, failure reason, manual handling, and file metadata privacy',
  )

  const heartbeatModel = section(prismaSchema, 'model TerminalHeartbeat', '// ── PrintTaskStatusLog')
  mustContain(
    heartbeatModel,
    ['@@index([terminalId, createdAt])'],
    'TerminalHeartbeat must keep terminalId+createdAt index for latest heartbeat lookup',
  )

  mustContain(
    ciWorkflow,
    [
      'pnpm --filter @ai-job-print/api verify:print-scan-first-release',
      'pnpm --filter @ai-job-print/admin verify:admin-print-ops-visibility-ui',
    ],
    'CI must run print-scan first-release safety verification to prevent regressions',
  )

  mustContain(
    acceptancePackage,
    [
      'PENDING REAL-EVIDENCE',
      'PS-G0-01',
      'PS-G1-01',
      'PS-G2-02',
      'PS-G3-BIND-01',
      'PS-G3-DEG-01',
      'PS-G3-REC-01',
      'Recovery Service + Paid-Claim Code Guard Passed, Field Paid/Allowed Claim Pending',
      'PS-G4-01',
      'PS-G4-04',
      'Code Guard Passed; Field Screenshot/Manual Record Pending',
      'verify:admin-print-ops-visibility-ui',
      'terminalId',
      'agent_degraded',
      'localTaskDatabaseAvailable=false',
      'TASK_NOT_OWNED',
      'pending',
      'fail-closed',
      'Not Passed Yet',
      '原始截图、录屏、命令日志、SQL 输出、真机照片、打印实物照片和 Windows 现场日志必须保存在仓库外私有证据目录',
    ],
    'print-scan acceptance package must define evidence IDs, boundaries, and off-repo evidence handling',
  )

  mustContain(
    fieldRunbook,
    [
      '正式域名 / HTTPS 审批中时不作为当前阻塞项',
      'Mac 负责代码验证、证据包准备、候选构建检查和命令整理',
      '服务器负责 PostgreSQL migration',
      'Windows 主机负责 Terminal Agent、奔图真机出纸、Agent 降级 / 恢复',
      'PS-G1',
      'PS-G2',
      'PS-G3',
      'PS-G4',
      'agent.db.degraded-backup',
      'New-Item -ItemType Directory -Path $AgentDbPath',
      'better-sqlite3',
      'verify:print-scan-first-release',
      '不得宣称打印扫描商用全闭环完成',
    ],
    'print-scan field execution runbook must split Mac/server/Windows responsibilities and keep domain approval out of the current blocker path',
  )

  mustContain(
    nextTasks,
    ['首期安全底座现场验收', 'G0 证据包与 CI 防回退已建立', '正式域名 / HTTPS 审批暂不作为当前阻塞项', 'print-scan-field-execution-runbook.md', 'Mac、候选服务器、Windows 一体机 + 奔图真机三段', '补齐 PS-G1~PS-G4 证据'],
    'next-tasks must keep field acceptance as an explicit remaining task',
  )

  assertNoOverclaim(
    acceptancePackage + '\n' + fieldRunbook + '\n' + currentProgress + '\n' + nextTasks,
    'print-scan docs must not overclaim Windows hardware, real scan, USB, production, or trial-operation completion',
  )

  if (failed > 0) {
    console.error(`\nverify-print-scan-first-release failed: ${failed} issue(s)`)
    process.exit(1)
  }

  console.log('\n✅ ALL PASS — print-scan first-release safety invariants hold')
}

main()
