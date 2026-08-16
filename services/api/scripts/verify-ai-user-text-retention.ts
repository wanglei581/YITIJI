/**
 * AI 用户原话的「落库与日志」门禁（F6 合规与隐私 · 批次 PII-STORAGE）。
 *
 * 守的是**与「送不送原文给模型」无关的那一半**：不管产品最终裁决要不要把用户
 * 原话送给大模型，用户的原话都不该以明文长期躺在数据库里、也不该出现在日志里。
 *
 * 覆盖：
 *  1. 审计面派生：扫全仓找出「会构造 LLM/ASR 请求或落 AI 服务日志」的模块，
 *     新增 AI 能力模块自动进入审计面（不是硬编码模块清单）。
 *  2. 落库面派生：审计面模块里所有 `prisma.<model>.create/upsert/createMany`
 *     写入的模型，必须要么自带 expiresAt、要么级联挂在带 expiresAt 的父模型上，
 *     否则必须在 NO_TTL_REGISTRY 显式登记理由。
 *  3. 清理必须真的执行：每个带 expiresAt 的模型必须有 deleteMany 按期限硬删
 *     （直接删，或经 onDelete: Cascade 由被删的父模型带走）。只在读路径按
 *     expiresAt 过滤**不算**清理 —— 那正是本批次查出来的 advisor 缺口。
 *  4. 日志不出现用户原话：审计面模块里所有 logger/console 调用的模板插值，
 *     不得引用用户自由文本变量（长度 / 条数 / 错误码等元数据放行）。
 *  5. 审计 payload 不出现用户原话：audit.write 的 payload 键名同上。
 *  6. 「我的记录」反向锚：读路径必须把用户**原话**返回给本人，
 *     不得为了合规把展示内容换成 `[姓名_1]` 这类占位符。
 *  7. advisor 专项回归锚 + 留存矩阵文档一致性。
 *
 * 刻意不检查「prompt 里有没有脱敏」——那是 verify:llm-input-pii-mask 的职责，
 * 且 AI 助手对话 / 面试转写要不要脱敏后送模型仍待产品裁决（见 PR #646）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:ai-user-text-retention
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve, sep } from 'path'

const apiRoot = resolve(__dirname, '..')
const repoRoot = resolve(apiRoot, '../..')
const srcRoot = resolve(apiRoot, 'src')

let passCount = 0
const failures: string[] = []

function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}

function assert(condition: boolean, message: string): void {
  if (condition) pass(message)
  else {
    failures.push(message)
    console.error(`  FAIL ${message}`)
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ─────────────────────────────`)
}

function readRepo(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

// ── 源码收集 ──────────────────────────────────────────────────────────────────

interface SourceFile {
  /** 相对 src 的 posix 路径，如 'advisor/advisor.service.ts' */
  readonly rel: string
  /** 顶层模块目录名，如 'advisor'；根文件为 '.' */
  readonly module: string
  readonly text: string
}

/**
 * 不扫的目录。
 *
 * `generated` 必须排除：Prisma client 生成到 src/generated/prisma，其 JSDoc 里
 * 每个模型都有 `await prisma.xxx.create(...)` 的示例代码，会被下面的落库面正则
 * 当成真实调用点，把全部 90 个模型误判成「AI 模块写入」。CI 是先 prisma generate
 * 再跑 verify 的，所以这个排除不是可选项 —— 漏掉它门禁在 CI 上必红。
 */
const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'generated', 'dist'])

function collectSources(dir: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      collectSources(full, out)
      continue
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts') || entry.endsWith('.test.ts')) continue
    const rel = relative(srcRoot, full).split(sep).join('/')
    out.push({ rel, module: rel.includes('/') ? rel.split('/')[0]! : '.', text: readFileSync(full, 'utf8') })
  }
}

const sources: SourceFile[] = []
collectSources(srcRoot, sources)
// 排除失效会让整份门禁的语义悄悄崩掉（见 SKIP_DIRS 注释），所以直接断言。
if (sources.some((f) => f.rel.includes('generated/'))) {
  console.error('  FAIL 扫描面混入了 Prisma 生成代码（src/generated/**），落库面判定会失真')
  process.exit(1)
}

// ── Prisma schema 解析 ────────────────────────────────────────────────────────

const schemaText = readFileSync(resolve(apiRoot, 'prisma/schema.prisma'), 'utf8')

interface SchemaModel {
  readonly name: string
  readonly body: string
  readonly hasExpiresAt: boolean
  /** onDelete: Cascade 指向的父模型名（本行被父行删除时一起消失） */
  readonly cascadeParents: readonly string[]
}

function parseModels(text: string): Map<string, SchemaModel> {
  const out = new Map<string, SchemaModel>()
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1]!
    const body = m[2]!
    const cascadeParents = [
      ...body.matchAll(/^\s*\w+\s+(\w+)\s+@relation\([^\n]*onDelete:\s*Cascade/gm),
    ].map((x) => x[1]!)
    out.set(name, {
      name,
      body,
      hasExpiresAt: /^\s*expiresAt\s/m.test(body),
      cascadeParents,
    })
  }
  return out
}

const models = parseModels(schemaText)
const camel = (name: string): string => name[0]!.toLowerCase() + name.slice(1)
const modelByCamel = new Map([...models.values()].map((mm) => [camel(mm.name), mm]))

// ── 1. 审计面派生 ─────────────────────────────────────────────────────────────
//
// 判定特征刻意保持**宽**：只要文件里出现「直接发 chat/completions」「记 AI 服务
// 日志」「用 LLM 遮盖 helper」「调 ASR 语音转写」任一，就把它所在的顶层模块拉进来。
// 收窄成「必须 import 某个具体 service」会漏掉走注入式 fetch 的实现，而漏掉正是
// 本门禁要防的事。

section('1. 审计面派生（AI 自由文本模块）')

const AI_SURFACE_MARKERS = [
  /chat\/completions/,
  /\bAiLogService\b/,
  /\bmaskUserTextForLlm\w*/,
  /\bAsrService\b/,
] as const

const auditModules = new Set<string>()
for (const file of sources) {
  if (file.module === '.') continue
  if (AI_SURFACE_MARKERS.some((re) => re.test(file.text))) auditModules.add(file.module)
}

const MIN_AUDIT_MODULES = 5
assert(
  auditModules.size >= MIN_AUDIT_MODULES,
  `派生出的 AI 自由文本模块 ≥ ${MIN_AUDIT_MODULES} 个（实际 ${auditModules.size}：${[...auditModules].sort().join(', ')}）`,
)
for (const expected of ['ai', 'advisor', 'mock-interview']) {
  assert(auditModules.has(expected), `审计面覆盖已知 AI 会话模块 ${expected}`)
}

const auditFiles = sources.filter((f) => auditModules.has(f.module))

// ── 2. 落库面派生：审计面写入的模型必须声明留存期限 ──────────────────────────

section('2. 落库面：AI 模块写入的模型必须有留存期限')

/**
 * 明确豁免「无 expiresAt」的模型 —— 只放行**不含用户自由文本**的元数据表。
 * 想新增一条，必须写清为什么它不承载用户原话（理由 < 20 字直接 FAIL）。
 */
const NO_TTL_REGISTRY: Record<string, string> = {
  AiServiceLog:
    '只落 operation/provider/status/latency/token 等元数据，无任何用户文本字段；按 AI_SERVICE_LOG_RETENTION_DAYS 由 AiResultCleanupTask 定期硬删',
  AuditLog:
    '审计留痕表，payload 受本门禁第 5 节约束不得含用户原话；留存期由审计合规要求决定，不随会话 TTL 走',
  JobDataQualitySnapshot:
    '岗位数据源质量快照，只存机构/岗位维度的统计指标，不含任何求职者输入的文本',
  UserAiConsent:
    '同意记录必须与账号同生命周期，撤回写 revokedAt 而不是删除；不含用户自由文本',
}

const writtenModels = new Map<string, string[]>()
for (const file of auditFiles) {
  for (const m of file.text.matchAll(/\b(?:prisma|tx)\.(\w+)\.(?:create|createMany|upsert)\(/g)) {
    const model = modelByCamel.get(m[1]!)
    if (!model) continue
    const list = writtenModels.get(model.name) ?? []
    if (!list.includes(file.rel)) list.push(file.rel)
    writtenModels.set(model.name, list)
  }
}

assert(writtenModels.size > 0, `派生出 AI 模块的落库模型清单（实际 ${writtenModels.size} 个模型）`)

/** 模型自身有 expiresAt，或能沿 Cascade 链走到一个有 expiresAt 的祖先。 */
function retentionAnchor(name: string, seen = new Set<string>()): string | null {
  const model = models.get(name)
  if (!model || seen.has(name)) return null
  seen.add(name)
  if (model.hasExpiresAt) return name
  for (const parent of model.cascadeParents) {
    const anchor = retentionAnchor(parent, seen)
    if (anchor) return anchor
  }
  return null
}

for (const [name, files] of [...writtenModels].sort()) {
  const anchor = retentionAnchor(name)
  if (anchor) {
    assert(true, `${name} 声明了留存期限（锚点 ${anchor}；写入方 ${files[0]}）`)
    continue
  }
  const reason = NO_TTL_REGISTRY[name]
  if (!reason) {
    assert(
      false,
      `${name} 由 AI 模块写入（${files.join(', ')}）却既无 expiresAt、也不级联在带 expiresAt 的父模型上，且未在 NO_TTL_REGISTRY 登记理由`,
    )
    continue
  }
  assert(reason.length >= 20, `NO_TTL_REGISTRY[${name}] 的豁免理由足够具体（≥20 字）`)
}

// 陈旧登记检测：登记了一个其实已经有 TTL、或已经不再被 AI 模块写入的模型 → FAIL
for (const name of Object.keys(NO_TTL_REGISTRY)) {
  assert(models.has(name), `NO_TTL_REGISTRY[${name}] 指向的模型仍存在于 schema`)
  assert(
    retentionAnchor(name) === null,
    `NO_TTL_REGISTRY[${name}] 仍然确实没有 TTL 锚点（若已补上请从登记表移除）`,
  )
}

// ── 3. 有 expiresAt 就必须真的被物理删除 ──────────────────────────────────────

section('3. 留存期限必须被物理执行（不能只在读路径过滤）')

const allSrcText = sources.map((f) => f.text).join('\n')

/**
 * 全仓是否存在对该模型按期限的物理删除。
 *
 * 认 `.delete(` 与 `.deleteMany(` 两种形态（FilesService 是先查过期集合再逐条删），
 * 期限条件在调用点前后一段窗口内出现即可 —— 项目里常见把 where 抽成
 * `expiredWhere` 变量或先算出 `expired` 列表再循环删。
 */
const DEADLINE_HINT = /expiresAt|cutoff|[Ee]xpired|retentionDays/
function hasDirectReaper(name: string): boolean {
  const needle = `.${camel(name)}.delete`
  let idx = allSrcText.indexOf(needle)
  while (idx !== -1) {
    const window = allSrcText.slice(Math.max(0, idx - 1200), idx + 400)
    if (DEADLINE_HINT.test(window)) return true
    idx = allSrcText.indexOf(needle, idx + 1)
  }
  return false
}

/** 直接删，或某个 Cascade 祖先被直接删（父行消失 → 本行随之消失）。 */
function isReaped(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false
  seen.add(name)
  if (hasDirectReaper(name)) return true
  const model = models.get(name)
  if (!model) return false
  return model.cascadeParents.some((p) => isReaped(p, seen))
}

const retentionModels = new Set<string>()
for (const [name] of writtenModels) {
  const anchor = retentionAnchor(name)
  if (anchor) retentionModels.add(anchor)
  // 子表自己也可能带独立 TTL（如 AdvisorArtifact 的 ADVISOR_ARTIFACT_TTL_HOURS）
  if (models.get(name)?.hasExpiresAt) retentionModels.add(name)
}

assert(retentionModels.size > 0, `派生出需要物理清理的模型清单（实际 ${retentionModels.size} 个）`)
for (const name of [...retentionModels].sort()) {
  assert(
    isReaped(name),
    `${name} 声明了 expiresAt 且被 AI 模块写入，必须有按期限的 deleteMany 硬删（只在读路径过滤不算清理）`,
  )
}

// ── 4. 日志不得出现用户原话 ───────────────────────────────────────────────────

section('4. 日志只记元数据，不记用户原话')

/** 用户自由文本变量的词根。命中即视为「可能是用户原话」。 */
const USER_TEXT_ROOT =
  /\b(content|topic|transcript|answer|reply|prompt|slots|slotsJson|resumeText|resumeDigest|extractedText|userText|rawText|question|userMessage|inputMessage)\b/i
/** 元数据访问器：取长度 / 条数 / 存在性，不泄露内容。 */
const METADATA_ACCESSOR = /\.(length|size|count|byteLength)\b|^!!|^Boolean\(|^Number\(/
/** 错误对象的 name/message：既有全仓通行写法，不在本门禁范围内（另见未验证项）。 */
const ERROR_ACCESSOR = /^\(?\s*\w*(err|error|e)\s*(as\s+Error)?\s*\)?\.(message|name|constructor)/i

const LOG_CALL = /(?:this\.logger|console)\.(?:log|warn|error|debug|verbose)\s*\(/g

function extractInterpolations(text: string, start: number): string[] {
  // 从调用括号起，截到本次调用大致结束（括号配平），再抓所有 ${...}
  let depth = 0
  let i = start
  for (; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = text.slice(start, i + 1)
  return [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]!.trim())
}

let scannedLogCalls = 0
for (const file of auditFiles) {
  const leaks: string[] = []
  for (const m of file.text.matchAll(LOG_CALL)) {
    scannedLogCalls += 1
    const open = file.text.indexOf('(', m.index!)
    for (const expr of extractInterpolations(file.text, open)) {
      if (METADATA_ACCESSOR.test(expr) || ERROR_ACCESSOR.test(expr)) continue
      if (USER_TEXT_ROOT.test(expr)) leaks.push(expr)
    }
  }
  assert(
    leaks.length === 0,
    leaks.length === 0
      ? `${file.rel} 的日志只记元数据`
      : `${file.rel} 的日志插值引用了用户自由文本（${leaks.join(' / ')}），日志只允许记长度/条数/错误码等元数据`,
  )
}
const MIN_LOG_CALLS = 20
assert(
  scannedLogCalls >= MIN_LOG_CALLS,
  `扫到的日志调用点 ≥ ${MIN_LOG_CALLS}（实际 ${scannedLogCalls}；过低说明扫描规则已失效）`,
)

// ── 5. 审计 payload 不得出现用户原话 ──────────────────────────────────────────

section('5. 审计 payload 只记元数据')

let scannedAuditWrites = 0
for (const file of auditFiles) {
  const leaks: string[] = []
  for (const m of file.text.matchAll(/payload:\s*\{([^}]*)\}/g)) {
    scannedAuditWrites += 1
    const keys = [...m[1]!.matchAll(/(\w+)\s*:/g)].map((k) => k[1]!)
    const shorthand = [...m[1]!.matchAll(/(?:^|,)\s*(\w+)\s*(?=,|$)/g)].map((k) => k[1]!)
    for (const key of [...keys, ...shorthand]) {
      if (METADATA_ACCESSOR.test(key)) continue
      if (USER_TEXT_ROOT.test(key)) leaks.push(key)
    }
  }
  if (scannedAuditWrites === 0) continue
  assert(
    leaks.length === 0,
    leaks.length === 0
      ? `${file.rel} 的审计 payload 只记元数据`
      : `${file.rel} 的审计 payload 键 ${leaks.join(' / ')} 疑似用户自由文本，审计只允许记元数据`,
  )
}
assert(scannedAuditWrites >= 5, `扫到的 payload 字面量 ≥ 5（实际 ${scannedAuditWrites}）`)

// ── 6. 反向锚：「我的记录」必须仍能看到自己的原话 ─────────────────────────────
//
// 这条是为了挡住「为了合规把展示内容也换成 [姓名_1]」的错误修法。
// 用户看自己的记录时看到的必须是他自己写的字。

section('6. 本人回看必须是原话（不得把展示内容也遮盖掉）')

const interviewService = readRepo('services/api/src/mock-interview/mock-interview.service.ts')
assert(
  /content:\s*t\.content/.test(interviewService),
  '模拟面试报告仍逐字返回本人回答原文（content: t.content），未被遮盖替换',
)
assert(
  !/maskUserTextForLlm/.test(interviewService),
  '模拟面试的落库/读取路径不引入 LLM 遮盖（遮盖只属于送模型那一步，且仍待产品裁决）',
)

const advisorService = readRepo('services/api/src/advisor/advisor.service.ts')
assert(
  /topic:\s*row\.topic/.test(advisorService),
  '顾问会话回读仍返回用户自己写的诉求原文（topic: row.topic）',
)
assert(
  !/mask\w*\(\s*trimmedTopic|topic:\s*mask/.test(advisorService),
  '顾问会话落库的 topic 未被改写成占位符版本（本人回看要看到原话）',
)

// ── 7. 对话不落库承诺 + advisor 清理回归锚 ────────────────────────────────────

section('7. 对话不落库承诺 + 顾问留存清理回归锚')

const llmChat = readRepo('services/api/src/ai/llm/llm-chat.service.ts')
assert(
  /private readonly sessions = new Map</.test(llmChat),
  'AI 助手对话历史只在进程内存（Map）里保留，不落库',
)
assert(
  !/prisma\./.test(llmChat),
  'AI 助手对话服务不持有 Prisma —— 对话原文没有任何落库路径',
)
assert(
  /SESSION_TTL_MS/.test(llmChat) && /pruneSessions/.test(llmChat),
  'AI 助手对话内存会话按 TTL 主动淘汰（pruneSessions）',
)

const retentionTaskPath = 'services/api/src/advisor/advisor-retention.task.ts'
assert(existsSync(resolve(repoRoot, retentionTaskPath)), `${retentionTaskPath} 存在`)
const retentionTask = readRepo(retentionTaskPath)
assert(/@Cron\(CronExpression\.EVERY_HOUR\)/.test(retentionTask), '顾问留存清理挂在每小时 cron 上')
assert(
  /advisorSession\.deleteMany\(\{\s*where:\s*\{\s*expiresAt:\s*\{\s*lt:/.test(retentionTask),
  '顾问清理按 expiresAt 物理删除过期会话（级联 pins/artifacts）',
)
assert(
  /advisorArtifact\.deleteMany\(\{\s*where:\s*\{\s*expiresAt:\s*\{\s*lt:/.test(retentionTask),
  '顾问清理同时删掉「会话未过期但自身 TTL 已到」的产物',
)
assert(
  /action:\s*'advisor_session\.cleanup_expired'/.test(retentionTask),
  '顾问清理写系统审计（CLAUDE.md §11：删除后需保留删除日志）',
)

const advisorModule = readRepo('services/api/src/advisor/advisor.module.ts')
// 只断言「文件里出现过 AdvisorRetentionTask」是不够的 —— 一条 import 就能骗过它。
// 必须落在 providers 数组里，否则 Nest 不实例化，@Cron 永远不会被注册。
const providersBlock = /providers:\s*\[([\s\S]*?)\]/.exec(advisorModule)
assert(providersBlock !== null, 'AdvisorModule 有 providers 数组')
assert(
  !!providersBlock && /\bAdvisorRetentionTask\b/.test(providersBlock[1]!),
  'AdvisorRetentionTask 出现在 AdvisorModule 的 providers 数组里（只 import 不注册 = cron 永不触发）',
)

// ── 8. 留存矩阵文档与代码常量一致 ─────────────────────────────────────────────

section('8. 留存矩阵文档一致性')

const retentionDocPath = 'docs/compliance/member-personal-data-retention.md'
assert(existsSync(resolve(repoRoot, retentionDocPath)), `${retentionDocPath} 存在`)
const retentionDoc = readRepo(retentionDocPath)

const advisorSessionTtlDefault = /ADVISOR_SESSION_TTL_HOURS'\]\)\s*\n?\s*return Number\.isFinite\(raw\) && raw > 0 \? raw : (\d+)/.exec(
  advisorService,
)
assert(advisorSessionTtlDefault !== null, '能从代码里解析出顾问会话默认 TTL 常量')
if (advisorSessionTtlDefault) {
  const hours = advisorSessionTtlDefault[1]!
  assert(
    retentionDoc.includes('AdvisorSession') && retentionDoc.includes(`${hours} 小时`),
    `留存矩阵声明顾问会话留存 ${hours} 小时，与代码默认值一致`,
  )
}
assert(
  retentionDoc.includes('AdvisorArtifact'),
  '留存矩阵覆盖顾问产物（AdvisorArtifact）',
)
assert(
  retentionDoc.includes('verify:ai-user-text-retention'),
  '留存矩阵的「当前验证门禁」列出本门禁',
)

// ── 收尾 ──────────────────────────────────────────────────────────────────────

console.log('')
if (failures.length > 0) {
  console.error(`\n${failures.length} FAIL / ${passCount} PASS`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`ALL PASS (${passCount})`)
