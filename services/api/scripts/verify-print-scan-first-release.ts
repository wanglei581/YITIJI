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

// 诚实待办/免责限定词：命中这些词的分句不算过度宣称。
// 「仍需」「有待」是同义变体（仍需…完成 / 有待…完成），需要同步维护避免只堵一个漏一个。
const OVERCLAIM_ALLOWED_QUALIFIERS =
  /(不代表|不等于|不得|不能|禁止|尚未|未执行|未完成|未通过|待现场|待补齐|仍需|有待|需要|否|Not Passed Yet|PENDING|Blocked|阻塞|只代表|写成)/
const OVERCLAIM_PATTERNS = [
  /Windows\s*真机[^。\n|]{0,40}(已通过|通过|完成|已完成|可上线|可商用)/,
  /真实扫描[^。\n|]{0,40}(已通过|通过|完成|已完成|可上线|可商用)/,
  /U\s*盘[^。\n|]{0,40}(已通过|通过|完成|已完成|可上线|可商用)/,
  /打印扫描[^。\n|]{0,40}(商用全闭环|生产完成|试运营完成|可上线|可商用)/,
  /小范围试运营[^。\n|]{0,40}(已通过|通过|完成|已完成|可进入|允许进入)/,
  /全部\s*Gate[^。\n|]{0,40}(已通过|通过|完成|已完成)/,
]

function findOverclaimOffenders(source: string): { index: number; line: string }[] {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + 1, line: line.trim() }))
    .filter(({ line }) => line.length > 0)
    .flatMap(({ index, line }) =>
      // 顿号「、」刻意不参与切分：文档主流诚实句式是「不代表 A 已完成、B 已通过、C 已完成」，
      // 否定词统辖整个顿号列举，切开会把列举项与否定词切断造成大面积误伤（实测 20 处）。
      // 代价是「X 已完成、Y 仍需补验」这类混合极性句会被整句豁免——已知盲区，本脚本是绊网不是证明系统。
      line
        .split(/[|。；;，,]/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => ({ index, line: segment })),
    )
    .filter(
      ({ line }) =>
        OVERCLAIM_PATTERNS.some((pattern) => pattern.test(line)) && !OVERCLAIM_ALLOWED_QUALIFIERS.test(line),
    )
}

function assertNoOverclaim(source: string, message: string): void {
  const offenders = findOverclaimOffenders(source)

  if (offenders.length === 0) {
    pass(message)
    return
  }

  fail(`${message}，疑似过度宣称: ${offenders.map(({ index, line }) => `L${index}: ${line}`).join(' | ')}`)
}

// 回归覆盖：assertNoOverclaim 的正则逻辑不依赖真实文档内容，用合成用例锁定行为，
// 防止未来再出现「诚实待办表述被误伤」或「真正过度宣称被放过」。
function assertOverclaimHeuristicFixtures(): void {
  const shouldFlag = [
    'Windows 真机已完成验收。',
    '真实扫描已通过验收测试。',
    'U盘打印已完成联调。',
    '打印扫描商用全闭环生产完成。',
    '小范围试运营已通过验收。',
    '全部 Gate 已通过。',
  ]
  const shouldNotFlag = [
    // 2026-07-10 曾在 docs/progress/current-progress.md 触发误判的真实句子
    'PostgreSQL 预生产 migration 执行、真机 register/heartbeat 实测、`enabled=false` 行为验收仍需在 Windows 真机 + 预生产环境完成，未预生产、未真机。',
    'Windows 真机验收有待完成。',
    '真实扫描仍需在真机上完成验收。',
    'U盘打印仍需真机验收完成。',
    '小范围试运营仍需完成现场验收。',
    '全部 Gate 仍需完成。',
    // 否定词统辖顿号列举的惯用句式：验收/进度文档大量使用，锁定「、」不得加入分句切分符，
    // 否则列举项与开头的「不代表」被切断，此句会炸出 4 处误伤。
    '本文件不代表生产迁移已执行、Windows 真机完整验收已通过、真实扫描已完成、U 盘导入已完成、奔图彩色 mode 已确认或小范围试运营已完成。',
  ]

  const missedFlags = shouldFlag.filter((s) => findOverclaimOffenders(s).length === 0)
  const falsePositives = shouldNotFlag.filter((s) => findOverclaimOffenders(s).length > 0)

  if (missedFlags.length === 0 && falsePositives.length === 0) {
    pass('assertNoOverclaim 回归用例：过度宣称仍被拦截，诚实待办表述不被误伤')
    return
  }

  if (missedFlags.length > 0) {
    fail(`assertNoOverclaim 回归失败，漏判疑似过度宣称: ${missedFlags.join(' | ')}`)
  }
  if (falsePositives.length > 0) {
    fail(`assertNoOverclaim 回归失败，误伤诚实待办表述: ${falsePositives.join(' | ')}`)
  }
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
  const terminalsService = read('src/terminals/terminals.service.ts')
  const printJobsApi = read('../../apps/kiosk/src/services/print/printJobsApi.ts')
  const prismaSchema = read('prisma/schema.prisma')
  const adminTypes = read('../../apps/admin/src/services/api/types.ts')
  const adminTerminalsPage = read('../../apps/admin/src/routes/terminals/index.tsx')
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
    terminalsService,
    ['private async canTerminalClaimTasks', "latestHeartbeat.status !== 'agent_degraded'", 'latestHeartbeat.localTaskDatabaseAvailable !== false'],
    'backend must keep degraded Agent claim gate as defense-in-depth',
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

  const heartbeatModel = section(prismaSchema, 'model TerminalHeartbeat', '// ── PrintTaskStatusLog')
  mustContain(
    heartbeatModel,
    ['@@index([terminalId, createdAt])'],
    'TerminalHeartbeat must keep terminalId+createdAt index for latest heartbeat lookup',
  )

  mustContain(
    ciWorkflow,
    ['pnpm --filter @ai-job-print/api verify:print-scan-first-release'],
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
      'PS-G4-01',
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

  assertOverclaimHeuristicFixtures()

  if (failed > 0) {
    console.error(`\nverify-print-scan-first-release failed: ${failed} issue(s)`)
    process.exit(1)
  }

  console.log('\n✅ ALL PASS — print-scan first-release safety invariants hold')
}

main()
