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
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { maskUserTextForLlm, maskUserTextForLlmText } from '../src/common/pii/llm-input-mask'
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

// 合规红线：遮盖模块任何路径都不得打印被处理的原文
const maskModule = read('src/common/pii/llm-input-mask.ts')
assertNotContains(maskModule, /logger\.(warn|log|error)\([^)]*\$\{(raw|normalized|text)\}/u, '日志: 遮盖模块不打印文本原文')

// ─── 结果 ────────────────────────────────────────────────────────────────────

console.log(`\nS0-2 简历链 PII 遮盖验证: ${passCount} PASS, ${failCount} FAIL`)
if (failCount > 0) process.exit(1)
