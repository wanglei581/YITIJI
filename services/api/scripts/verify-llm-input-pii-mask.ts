/**
 * S0-2 / 风险 R2：简历链复用合同审查的 PII 遮盖。
 *
 * 为什么需要这条守门：
 *   PII masker 此前只在 contract-review/ 内使用，简历链（A 组）与定向输出链（B 组）
 *   把简历原文**未脱敏**直送第三方模型 —— 姓名 / 手机 / 身份证 / 邮箱 / 住址原样出境。
 *   本脚本守住「遮盖真的发生了」，而不是「代码里写了一行遮盖」。
 *
 * 覆盖：
 *   1. 高置信 PII（身份证 / 手机 / 邮箱 / 银行卡 / 带标签的姓名地址）确实被替换
 *   2. 非 PII 正文（技能、公司、职位、项目描述）**不被**误伤 —— 误伤等于降低诊断质量
 *   3. 简历日期时间轴（2015.09-2019.06 …）不会让遮盖抛错打死主流程；
 *      这正是不能照抄合同链路 fail-closed 断言的原因，本条是该决策的回归锚
 *   4. 空串 / 非法输入 / 超长输入不抛错
 *   5. \r\n 输入能被正常遮盖（PDF/Windows 抽取文本常见，若不归一会白走兜底路径）
 *   6. 兜底路径本身有效：即使遮盖引擎失败也不会返回原文
 *   7. contract-review 侧行为未变：薄壳 re-export 与 common/pii 同一实现，
 *      且仍是默认 fail-closed（assertComplete 默认 true）
 *   8. 静态：4 个 LLM 调用点确实把遮盖后的文本喂进 prompt，
 *      且 job-fit / career-plan 的防编造校验用的是**送出去的那一份**
 *
 * 不触网、不碰 DB。
 * 运行：pnpm --filter @ai-job-print/api verify:llm-input-pii-mask
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { maskUserTextForLlm, maskUserTextForLlmText, maskUserTextForLlmReversible } from '../src/common/pii/llm-input-mask'
import { maskContractText } from '../src/common/pii/pii-masker'
import { maskContractText as maskViaShim } from '../src/contract-review/contract-review-pii-masker'

const ROOT = join(__dirname, '..')

let passCount = 0
let failCount = 0

function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }

function read(rel: string): string {
  const path = join(ROOT, rel)
  if (!existsSync(path)) { fail(`文件不存在: ${rel}`); return '' }
  return readFileSync(path, 'utf8')
}

function assertContains(src: string, pattern: string | RegExp, label: string) {
  const ok = typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src)
  ok ? pass(label) : fail(label)
}

function assertNotContains(src: string, pattern: string | RegExp, label: string) {
  const bad = typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src)
  bad ? fail(label) : pass(label)
}

// 全部为构造数据，不是真实个人信息。
const FAKE = {
  idNumber: '11010119900307461X',
  phone: '13800138000',
  email: 'zhangsan.demo@example.com',
  bankCard: '6222021234567890123',
  name: '张三',
  address: '北京市海淀区中关村南大街 5 号 3 单元 401',
}

const RESUME = [
  `姓名：${FAKE.name}`,
  `手机号：${FAKE.phone}`,
  `电子邮箱：${FAKE.email}`,
  `身份证号：${FAKE.idNumber}`,
  `银行卡号：${FAKE.bankCard}`,
  `住址：${FAKE.address}`,
  '',
  '教育经历',
  '2015.09-2019.06  某某大学  计算机科学与技术  本科',
  '2019.07-2022.06  某某大学  软件工程  硕士',
  '',
  '工作经历',
  '2022.07-2024.03  某科技有限公司  后端开发工程师',
  '负责订单结算服务的重构，将平均响应时间从 800ms 降到 220ms。',
  '',
  '技能',
  'TypeScript、NestJS、PostgreSQL、Redis、Kubernetes',
].join('\n')

// ─── 1. 高置信 PII 被替换 ────────────────────────────────────────────────────

const masked = maskUserTextForLlm(RESUME, 'verify')

for (const [label, raw] of Object.entries(FAKE)) {
  if (masked.text.includes(raw)) fail(`遮盖: ${label} 仍出现在送模型文本中`)
  else pass(`遮盖: ${label} 已被替换`)
}

if (masked.changed) pass('遮盖: changed=true（确实发生了替换）')
else fail('遮盖: changed 应为 true')

if (masked.degraded === false) pass('遮盖: 正常路径未触发兜底（degraded=false）')
else fail('遮盖: 不应触发兜底路径')

// ─── 2. 非 PII 正文不被误伤 ──────────────────────────────────────────────────

for (const keep of [
  '计算机科学与技术',
  '后端开发工程师',
  '订单结算服务的重构',
  'TypeScript、NestJS、PostgreSQL、Redis、Kubernetes',
  '800ms',
  '220ms',
]) {
  if (masked.text.includes(keep)) pass(`保真: 非 PII 内容保留「${keep.slice(0, 16)}」`)
  else fail(`保真: 非 PII 内容被误伤「${keep.slice(0, 16)}」`)
}

// ─── 3. 日期时间轴不得打死主流程 ─────────────────────────────────────────────
//
// 这段文本会让合同链路的数字游程扫描累积出 16 位以上连续数字（空白/点/连字符都算分隔符），
// 被判成银行卡而抛 CONTRACT_PII_MASK_INCOMPLETE。简历里这是完全正常的写法。
// 若哪天有人把简历链改回 fail-closed，本条会立刻 FAIL。

const TIMELINE = [
  '教育与工作时间轴',
  '2015.09-2019.06  2019.07-2022.06  2022.07-2024.03  2024.04-至今',
].join('\n')

let timelineResult: ReturnType<typeof maskUserTextForLlm> | null = null
try {
  timelineResult = maskUserTextForLlm(TIMELINE, 'verify-timeline')
  pass('降级: 简历日期时间轴不抛错（主流程不被脱敏打死）')
} catch (error) {
  fail(`降级: 简历日期时间轴抛错 ${error instanceof Error ? error.message : String(error)}`)
}
if (timelineResult) {
  if (timelineResult.text.includes('2015.09-2019.06')) pass('降级: 时间轴内容原样保留（未被误遮）')
  else fail('降级: 时间轴内容被误遮')
  if (timelineResult.degraded === false) pass('降级: 时间轴走的是正常遮盖路径，不是兜底')
  else fail('降级: 时间轴不应触发兜底路径')
}

// 同一段文本在合同链路（fail-closed）下应当抛错 —— 证明「假阳性」的判断不是臆测
try {
  maskContractText(TIMELINE)
  fail('对照: 合同链路对该时间轴未抛错（假阳性假设不成立，需重新评估简历链策略）')
} catch {
  pass('对照: 合同链路对同一时间轴 fail-closed 抛错 —— 简历链另设策略是必要的')
}

// ─── 4. 边界输入不抛错 ───────────────────────────────────────────────────────

for (const [label, input] of [
  ['空串', ''],
  ['纯空白', '   \n\n  '],
  ['超长文本', 'a'.repeat(60_000)],
  ['非字符串', undefined as unknown as string],
] as const) {
  try {
    const out = maskUserTextForLlm(input, 'verify-edge')
    if (typeof out.text === 'string') pass(`边界: ${label} 返回字符串不抛错`)
    else fail(`边界: ${label} 返回值异常`)
  } catch (error) {
    fail(`边界: ${label} 抛错 ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ─── 5. \r\n 输入仍走正常遮盖路径 ────────────────────────────────────────────

const crlf = maskUserTextForLlm(RESUME.replace(/\n/gu, '\r\n'), 'verify-crlf')
if (!crlf.text.includes(FAKE.phone) && !crlf.text.includes(FAKE.idNumber)) pass('归一: \\r\\n 输入的 PII 仍被遮盖')
else fail('归一: \\r\\n 输入的 PII 未被遮盖')
if (crlf.degraded === false) pass('归一: \\r\\n 输入未落到兜底路径（说明换行已被规整）')
else fail('归一: \\r\\n 输入落到了兜底路径')

// ─── 6. 便捷形态与「绝不返回原文」 ──────────────────────────────────────────

const textOnly = maskUserTextForLlmText(RESUME, 'verify-text')
if (textOnly === masked.text) pass('API: maskUserTextForLlmText 与 maskUserTextForLlm().text 一致')
else fail('API: 两个入口结果不一致')
if (textOnly !== RESUME) pass('API: 含 PII 的输入绝不原样返回')
else fail('API: 含 PII 的输入被原样返回')

// ─── 7. contract-review 侧行为未变 ──────────────────────────────────────────

const CONTRACT = [
  `甲方：某某科技有限公司  统一社会信用代码：91110108MA01ABCD2X`,
  `乙方：${FAKE.name}  身份证号：${FAKE.idNumber}  手机号：${FAKE.phone}`,
  '月薪为人民币 12000 元，合同期限为 3 年。',
].join('\n')

const viaDirect = maskContractText(CONTRACT)
const viaShim = maskViaShim(CONTRACT)
if (viaDirect.text === viaShim.text) pass('迁移: contract-review 薄壳与 common/pii 输出逐字一致')
else fail('迁移: 薄壳输出与 common/pii 不一致')
if (viaShim.partyFacts.hasWorker && viaShim.partyFacts.hasEmployer) pass('迁移: 薄壳仍返回 partyFacts')
else fail('迁移: 薄壳 partyFacts 缺失')
if (!viaShim.text.includes(FAKE.idNumber) && !viaShim.text.includes(FAKE.phone)) pass('迁移: 合同链路遮盖仍生效')
else fail('迁移: 合同链路遮盖失效')

const shimSrc = read('src/contract-review/contract-review-pii-masker.ts')
assertContains(shimSrc, "from '../common/pii/pii-masker'", '迁移: 薄壳 re-export 自 common/pii')

const orchestrator = read('src/contract-review/contract-review-orchestrator.service.ts')
assertNotContains(orchestrator, 'assertComplete', '迁移: 合同审查未关闭完整性断言（仍 fail-closed）')
// restoreMap 的 value 是未脱敏 PII。合同链路不需要还原，也不该拿到它 ——
// contract-review-pii-masker.test.ts 断言遮盖产物键集恒为 ['pages','partyFacts']。
assertNotContains(orchestrator, 'collectRestoreMap', '迁移: 合同审查未开启 restoreMap（遮盖产物不得夹带 PII）')
if (Object.keys(maskContractText(CONTRACT)).sort().join(',') === 'partyFacts,text') pass('迁移: 合同链路遮盖结果未夹带 restoreMap')
else fail('迁移: 合同链路遮盖结果多出字段，可能夹带 PII')

// ─── 8. 静态：4 个调用点确实喂的是遮盖后的文本 ─────────────────────────────

const diagnosis = read('src/ai/resume/llm-resume.service.ts')
assertContains(diagnosis, 'maskUserTextForLlmText', '接线: 简历诊断已接入遮盖')
assertNotContains(
  diagnosis,
  /const text = \(extractedText \?\? ''\)\.slice\(0, MAX_DIAGNOSIS_INPUT_CHARS\)\s*$/mu,
  '接线: 简历诊断不再直接用未遮盖文本',
)

const jobFit = read('src/ai/resume/llm-job-fit.service.ts')
assertContains(jobFit, 'const maskedResume = maskUserTextForLlmText', '接线: 岗位匹配已接入遮盖')
assertContains(jobFit, '【简历原文】\\n${maskedResume}', '接线: 岗位匹配 prompt 用遮盖后文本')
assertContains(jobFit, 'this.validate(parsed, maskedResume, job)', '接线: 岗位匹配防编造校验用送出去的那一份')
assertNotContains(jobFit, 'this.validate(parsed, resumeText, job)', '接线: 岗位匹配不再拿原文校验')

const careerPlan = read('src/ai/resume/llm-career-plan.service.ts')
assertContains(careerPlan, 'const maskedResume = maskUserTextForLlmText', '接线: 职业规划已接入遮盖')
assertContains(careerPlan, 'this.validate(parsed, maskedResume)', '接线: 职业规划防编造校验用送出去的那一份')
assertNotContains(careerPlan, 'this.validate(parsed, ctx.resumeText)', '接线: 职业规划不再拿原文校验')

const fairVisit = read('src/ai/resume/llm-fair-visit-plan.service.ts')
assertContains(fairVisit, 'maskUserTextForLlmText(ctx.resumeText', '接线: 招聘会拜访计划已接入遮盖')

// ─── 8b. 新修复的两个调用点（回归锚）─────────────────────────────────────────
//
// 这两处此前把**简历原文逐字**拼进 prompt，而本门禁只硬编码检查 4 个文件，
// 完全看不到它们。下面的断言就是「改回去必须红」的那道闸。

const optimize = read('src/ai/resume/llm-resume-optimize.service.ts')
assertContains(optimize, 'maskUserTextForLlmReversible', '接线: 简历优化已接入可还原遮盖')
assertContains(optimize, 'const text = masked.text', '接线: 简历优化 prompt 用遮盖后文本')
assertNotContains(optimize, '简历原文:\\n${(extractedText', '接线: 简历优化不再直送 extractedText')
assertNotContains(optimize, '原始简历文本:\\n${originalText}', '接线: 排版调整不再直送 originalText 原文')
assertContains(optimize, '原始简历文本:\\n${maskedOriginal}', '接线: 排版调整 prompt 用遮盖后原文')
assertNotContains(optimize, '${JSON.stringify(input.currentResume)}', '接线: 排版调整不再把含 PII 的结构化简历直送模型')
assertContains(optimize, '${maskedResumeJson}', '接线: 排版调整 prompt 用遮盖后的结构化简历')
// 事实基线必须是「送出去的那一份」，否则模型回包里的占位符会判不在原文而整单作废
assertContains(optimize, 'this.parseAndValidate(raw, text,', '接线: 简历优化防编造校验用送出去的那一份')
assertContains(optimize, 'const factSource = `${maskedOriginal}\\n${maskedResumeValues}`', '接线: 排版调整事实基线用遮盖后文本')
// 事实基线仍只由字段值构成：改用 JSON 串会让字段名变成合法事实来源 = 放宽既有断言
assertContains(optimize, 'extractResumeValueText(input.currentResume)', '防编造: 排版调整事实基线仍只取字段值(不含字段名)')
// 产物要还给本人 → 必须还原，否则用户简历上印的是 [手机号_1]
assertContains(optimize, 'restoreOptimizeResult(result, masked.restore)', '还原: 简历优化产物已还原真值')
assertContains(optimize, 'restoreLayoutAdjustResult(result, maskedTriple.restore', '还原: 排版调整产物已还原真值')

const jobAi = read('src/job-ai/job-ai-llm.service.ts')
assertContains(jobAi, 'maskUserTextForLlmText(resumePlainText', '接线: 岗位推荐已接入遮盖')
assertContains(jobAi, '【简历原文】\\n${maskedResume}', '接线: 岗位推荐 prompt 用遮盖后文本')
assertNotContains(jobAi, '【简历原文】\\n${resumePlainText', '接线: 岗位推荐不再直送简历原文')

// ─── 8c. 派生清单：新增 LLM 调用点默认必须遮盖 ───────────────────────────────
//
// 为什么必须派生：本门禁原来只按文件名硬编码检查 4 个调用点，而全仓真正发起
// LLM 调用的文件有十几个。硬编码清单的失效方式是**静默的** —— 新增一个调用点，
// 门禁不报错、不提示，只是看不见它。llm-resume-optimize / job-ai-llm 这两个
// 「简历原文直送」正是这么长期躲过检查的。
//
// 规则：凡是真正发起 chat/completions 调用的源文件，必须落在下面两类之一：
//   1. 引入了遮盖 helper（maskUserTextForLlm* / maskContractPages）；
//   2. 在 NO_MASK_REGISTRY 里显式登记，写明「为什么不需要遮盖」或「已知缺口」。
// 两者都不满足 → FAIL。默认值是「必须遮盖」，不是「默认放行」。

type RegistryEntry = {
  reason: string
  /** 该文件必须**不**出现的串；出现即说明登记理由已失效（如开始塞简历原文） */
  mustNotContain?: string[]
  /** 只在指定函数体内检查的禁止串（文件别处合法引用同名字段时用这个，避免误报） */
  mustNotContainInFn?: { fn: string; needles: string[] }
}

/** 粗粒度取出一个顶层函数的函数体（从声明行到下一个行首 `}`）。够用且无需 AST。 */
function functionBody(src: string, fnName: string): string | null {
  const start = src.search(new RegExp(`(?:function|const)\\s+${fnName}\\b`, 'u'))
  if (start < 0) return null
  const rest = src.slice(start)
  const end = rest.search(/\n\}/u)
  return end < 0 ? rest : rest.slice(0, end + 2)
}

const NO_MASK_REGISTRY: Record<string, RegistryEntry> = {
  'src/contract-review/contract-review-provider.service.ts': {
    reason: '合同链路的遮盖发生在上游 orchestrator（maskContractPages，fail-closed）；provider 只收已遮盖分页，自己不拼原文',
  },
  'src/trtc/trtc.service.ts': {
    reason: 'TRTC 语音机器人只把 LLM 端点/密钥透传给腾讯云做实时对话，本进程不拼任何用户材料 prompt',
    mustNotContain: ['简历原文', 'resumeText', 'extractedText'],
  },
  'src/ai/llm/llm-presets.ts': {
    reason: '仅声明各厂商 baseURL/model 常量，没有任何请求与 prompt 拼装（注释里出现 chat/completions 字样）',
    mustNotContain: ['fetch(', 'role:'],
  },
  'src/ai/resume/llm-resume-generate.service.ts': {
    reason: '简历生成按设计不把身份字段送模型：姓名/电话/邮箱由服务端直接复制，prompt 只含意向/经历/技能等非身份内容',
    // 身份字段一旦进 prompt，登记理由即失效。
    // 注意只能扫 prompt 构造函数体：文件别处（如「未填写联系方式」提示）合法引用这些字段。
    mustNotContainInFn: {
      fn: 'buildGenerateUserPrompt',
      needles: ['input.basic.name', 'input.basic.phone', 'input.basic.email', 'basic:'],
    },
  },
  'src/ai/resume/llm-self-assessment.service.ts': {
    reason: '自我探索只送维度 key/label/strength 分值，答案原文与身份信息都不进 prompt',
    mustNotContain: ['简历原文', 'resumeText', 'input.answers'],
  },
  // ── 已知缺口（本批次未修，不得当成已覆盖）──────────────────────────────
  'src/ai/llm/llm-chat.service.ts': {
    reason:
      '【已知缺口】AI 助手对话把用户输入原文送模型且未遮盖。与简历链不同，' +
      '对话里遮盖姓名会影响称呼与上下文连贯，需产品先定降级口径，故本批次未改。' +
      '登记在此是为了让它可见、可追踪，不是判定它安全。',
  },
  'src/mock-interview/mock-interview-llm.service.ts': {
    reason:
      '【已知缺口】模拟面试把候选人作答 transcript 原文送模型且未遮盖，' +
      '自我介绍环节常含姓名/学校。属独立范围（语音+文本双入口），本批次未改。' +
      '登记在此是为了让它可见、可追踪，不是判定它安全。',
  },
}

const MASK_HELPERS = ['maskUserTextForLlmText', 'maskUserTextForLlmReversible', 'maskUserTextForLlm', 'maskContractPages']

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'generated') continue
      walkTsFiles(rel, acc)
    } else if (entry.name.endsWith('.ts') && !rel.includes('__tests__') && !entry.name.endsWith('.spec.ts')) {
      acc.push(rel)
    }
  }
  return acc
}

// 探测规则刻意保持**宽**：凡是提到 chat/completions 的源文件都进清单。
// 不按 HTTP 客户端形态收窄 —— contract-review-provider 走注入的 fetchImpl、
// 别处走裸 fetch，按形态收窄必然漏掉调用点，而漏掉正是本门禁要防的事。
// 真正「不是调用点」的文件由 NO_MASK_REGISTRY 显式登记并附理由。
const llmCallFiles = walkTsFiles('src')
  .filter((rel) => readFileSync(join(ROOT, rel), 'utf8').includes('chat/completions'))
  .sort()

if (llmCallFiles.length === 0) fail('派生清单: 未发现任何 LLM 调用点（探测规则已失效，必须修门禁）')
else pass(`派生清单: 发现 ${llmCallFiles.length} 个 LLM 调用点`)

for (const rel of llmCallFiles) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  const masked = MASK_HELPERS.some((helper) => src.includes(helper))
  const registered = NO_MASK_REGISTRY[rel]

  if (masked) {
    pass(`派生清单: ${rel} 已接入遮盖`)
    if (registered) fail(`派生清单: ${rel} 已接入遮盖，请从 NO_MASK_REGISTRY 删除该条陈旧登记`)
    continue
  }
  if (!registered) {
    fail(`派生清单: ${rel} 既未接入遮盖，也未在 NO_MASK_REGISTRY 登记 —— 新增 LLM 调用点默认必须遮盖`)
    continue
  }
  if (registered.reason.length < 20) {
    fail(`派生清单: ${rel} 的免遮盖理由过短，必须写清为什么不需要遮盖`)
    continue
  }
  pass(`派生清单: ${rel} 已登记免遮盖理由`)
  for (const forbidden of registered.mustNotContain ?? []) {
    assertNotContains(src, forbidden, `派生清单: ${rel} 登记理由仍成立（未出现「${forbidden}」）`)
  }
  const scoped = registered.mustNotContainInFn
  if (scoped) {
    const body = functionBody(src, scoped.fn)
    if (body === null) {
      fail(`派生清单: ${rel} 找不到 prompt 构造函数 ${scoped.fn}()，登记理由已无法校验`)
    } else {
      for (const forbidden of scoped.needles) {
        assertNotContains(body, forbidden, `派生清单: ${rel} 的 ${scoped.fn}() 未把身份字段送模型（「${forbidden}」）`)
      }
    }
  }
}

// 陈旧登记：登记了一个已经不存在 / 已经不再调用 LLM 的文件
for (const rel of Object.keys(NO_MASK_REGISTRY)) {
  if (!llmCallFiles.includes(rel)) {
    fail(`派生清单: NO_MASK_REGISTRY 登记的 ${rel} 已不是 LLM 调用点，请删除该条`)
  }
}

// ─── 8d. 可还原遮盖：往返必须无损 ───────────────────────────────────────────
//
// 简历优化 / 排版调整的产物是用户要打印的简历。只遮盖不还原 = 把 [手机号_1]
// 印到用户简历上，属于「拿功能损坏换合规」。这里守住往返无损。

const rev = maskUserTextForLlmReversible(RESUME, 'verify-reversible')
for (const [label, raw] of Object.entries(FAKE)) {
  if (rev.text.includes(raw)) fail(`可还原: ${label} 仍出现在送模型文本中`)
  else pass(`可还原: ${label} 已被替换`)
}
if (rev.restore(rev.text) === RESUME) pass('可还原: restore(masked) 逐字还原为原文（往返无损）')
else fail('可还原: restore(masked) 未能还原为原文 —— 用户简历会印出占位符')
// 单字段还原（模型把占位符回显到结构化字段的真实形态）
if (rev.restore('[手机号_1]') === FAKE.phone) pass('可还原: 单个占位符可还原为真值')
else fail('可还原: 单个占位符还原失败')
// 模型编造的占位符不得炸掉流程
if (rev.restore('[手机号_99]') === '[手机号_99]') pass('可还原: 未知占位符原样保留（模型编造不致命）')
else fail('可还原: 未知占位符处理异常')
if (rev.restore('') === '' && rev.restore('纯正文无占位符') === '纯正文无占位符') pass('可还原: 无占位符输入原样返回')
else fail('可还原: 无占位符输入被改写')

// 合规红线：遮盖模块任何路径都不得打印被处理的原文
const maskModule = read('src/common/pii/llm-input-mask.ts')
assertNotContains(maskModule, /logger\.(warn|log|error)\([^)]*\$\{(raw|normalized|text)\}/u, '日志: 遮盖模块不打印文本原文')

// ─── 结果 ────────────────────────────────────────────────────────────────────

console.log(`\nS0-2 简历链 PII 遮盖验证: ${passCount} PASS, ${failCount} FAIL`)
if (failCount > 0) process.exit(1)
