/**
 * S0-3 / 风险 R3：`resume_optimize` 单点故障拆键。
 *
 * 为什么需要这条守门：
 *   拆键前，Admin 在「AI大模型」里关掉「AI简历优化」或改错凭证，会一并静默停掉
 *   岗位匹配 / 职业规划 / 招聘会拜访计划 / 自我探索解读 / 岗位推荐 / 岗位解读，
 *   运行端只表现为「未配置 / 不可用」，不会说明这层依赖。
 *   拆键的两条硬要求同等重要：
 *     (a) **默认行为不变** —— 未单独配置时必须继承 resume_optimize；
 *     (b) **不再连坐** —— 任一 key 挂掉不得导致其它能力不可用。
 *   本脚本两条都验。
 *
 * 覆盖：
 *   1. 6 个新 featureKey 已注册且 status=active，各自声明 inheritsFrom
 *   2. 未单独配置时：config / apiKey / isReady 三者全部继承父键（行为不变）
 *   3. getView.inheritedFrom 如实标注继承来源（Admin 不会误以为是本键自己的配置）
 *   4. 父键改动会实时传导到仍在继承的子键
 *   5. 单独配置子键后脱离继承；再改父键不影响该子键
 *   6. **反连坐**：停用任一子键，父键与其它子键全部不受影响
 *   7. **反连坐**：停用父键时，已独立配置的子键仍可用（这是拆键的核心收益）
 *   8. 重启后继承关系与独立配置都不丢（文件持久化）
 *   9. 历史配置文件（无 explicitlyConfigured 字段）向后兼容：老键行为不变、新键继承
 *  10. 静态：7 个消费方都改用了自己的 key，只有简历优化/版式仍留在 resume_optimize；
 *      注释里补上了此前漏登记的自我探索
 *
 * 纯 JSON 文件 + 加密，无 DB、不触网。临时 FILE_STORAGE_DIR，finally 清理。
 * 运行：pnpm --filter @ai-job-print/api verify:ai-feature-keys
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-ai-feature-keys-secret-encryption-key-0123456789'
const DATA_DIR = mkdtempSync(join(tmpdir(), 'vafk-data-'))
process.env['FILE_STORAGE_DIR'] = DATA_DIR
delete process.env['AI_LLM_API_KEY']
delete process.env['TRTC_LLM_API_KEY']

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AI_MODEL_FEATURES, LlmConfigService } = require('../src/ai/llm/llm-config.service') as
  typeof import('../src/ai/llm/llm-config.service')
type AiModelFeatureKey = import('../src/ai/llm/llm-config.service').AiModelFeatureKey

const ROOT = join(__dirname, '..')
const CONFIG_FILE = join(DATA_DIR, 'ai-model-configs.json')

const SPLIT_KEYS = ['job_fit', 'career_plan', 'fair_visit_plan', 'self_assessment', 'job_recommend', 'job_explain'] as const
const PARENT: AiModelFeatureKey = 'resume_optimize'

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

function main() {
  // ─── 1. 注册表 ────────────────────────────────────────────────────────────
  for (const key of SPLIT_KEYS) {
    const meta = AI_MODEL_FEATURES.find((f) => f.key === key)
    if (!meta) { fail(`注册表: 缺少 featureKey ${key}`); continue }
    pass(`注册表: 已注册 ${key}（${meta.label}）`)
    if (meta.status === 'active') pass(`注册表: ${key} status=active`)
    else fail(`注册表: ${key} status 应为 active，实际 ${meta.status}`)
    if (meta.inheritsFrom === PARENT) pass(`注册表: ${key} 默认继承 ${PARENT}`)
    else fail(`注册表: ${key} inheritsFrom 应为 ${PARENT}，实际 ${String(meta.inheritsFrom)}`)
    // 结构化 prompt 由服务端强制，这些键不得开放自定义 System Prompt
    if (meta.allowCustomSystemPrompt === false) pass(`注册表: ${key} 不开放自定义 System Prompt`)
    else fail(`注册表: ${key} 不应开放自定义 System Prompt`)
  }

  // ─── 2–4. 继承（默认行为不变）───────────────────────────────────────────
  const svc = new LlmConfigService()
  svc.update({ apiKey: 'sk-parent-0001', enabled: true, vendor: 'deepseek', model: 'parent-model' }, PARENT)

  for (const key of SPLIT_KEYS) {
    if (svc.getApiKey(key) === svc.getApiKey(PARENT)) pass(`继承: ${key} apiKey 继承自父键`)
    else fail(`继承: ${key} apiKey 未继承父键`)
    if (svc.getConfig(key).model === 'parent-model') pass(`继承: ${key} model 继承自父键`)
    else fail(`继承: ${key} model 未继承父键（实际 ${svc.getConfig(key).model}）`)
    if (svc.isReady(key)) pass(`继承: ${key} isReady 随父键为 true`)
    else fail(`继承: ${key} isReady 应随父键为 true`)
    if (svc.getView(key).inheritedFrom === PARENT) pass(`继承: ${key} getView 如实标注 inheritedFrom`)
    else fail(`继承: ${key} inheritedFrom 应为 ${PARENT}`)
  }

  // 4. 父键改动实时传导
  svc.update({ model: 'parent-model-v2' }, PARENT)
  if (svc.getConfig('job_fit').model === 'parent-model-v2') pass('继承: 父键改动实时传导到仍在继承的子键')
  else fail('继承: 父键改动未传导')

  // ─── 5. 单独配置后脱离继承 ───────────────────────────────────────────────
  svc.update({ apiKey: 'sk-jobfit-0001', model: 'jobfit-model' }, 'job_fit')
  if (svc.getView('job_fit').inheritedFrom === null) pass('独立: job_fit 配置后不再标注继承')
  else fail('独立: job_fit 配置后仍标注继承')
  if (svc.getApiKey('job_fit') === 'sk-jobfit-0001') pass('独立: job_fit 用自己的 apiKey')
  else fail('独立: job_fit apiKey 未生效')
  // 编辑基线取「当前生效配置」：只传 model/apiKey 时，enabled 应继承自父键当时的值
  if (svc.isReady('job_fit')) pass('独立: 固化时以父键当前生效配置为基线（enabled 未被 env 兜底覆盖）')
  else fail('独立: 固化后 isReady 变 false —— 编辑基线取错了')

  svc.update({ model: 'parent-model-v3' }, PARENT)
  if (svc.getConfig('job_fit').model === 'jobfit-model') pass('独立: 再改父键不影响已独立的 job_fit')
  else fail('独立: 已独立的 job_fit 被父键改动污染')
  if (svc.getConfig('career_plan').model === 'parent-model-v3') pass('独立: 其它子键仍继续继承')
  else fail('独立: 其它子键继承被破坏')

  // ─── 6. 反连坐：停用一个子键，其它全不受影响 ────────────────────────────
  svc.update({ enabled: false }, 'career_plan')
  if (!svc.isReady('career_plan')) pass('反连坐: career_plan 已被单独停用')
  else fail('反连坐: career_plan 停用未生效')
  if (svc.isReady(PARENT)) pass('反连坐: 停用子键不影响父键（简历优化仍可用）')
  else fail('反连坐: 停用子键把父键也停了')
  for (const key of ['fair_visit_plan', 'self_assessment', 'job_recommend', 'job_explain'] as const) {
    if (svc.isReady(key)) pass(`反连坐: 停用 career_plan 不影响 ${key}`)
    else fail(`反连坐: 停用 career_plan 连带停掉了 ${key}`)
  }
  if (svc.isReady('job_fit')) pass('反连坐: 停用 career_plan 不影响已独立的 job_fit')
  else fail('反连坐: 停用 career_plan 连带停掉了 job_fit')

  // ─── 7. 反连坐：停用父键，已独立的子键仍可用 ────────────────────────────
  svc.update({ enabled: false }, PARENT)
  if (!svc.isReady(PARENT)) pass('反连坐: 父键已停用')
  else fail('反连坐: 父键停用未生效')
  if (svc.isReady('job_fit')) pass('反连坐: 父键停用后已独立的 job_fit 仍可用（拆键核心收益）')
  else fail('反连坐: 父键停用把已独立的 job_fit 也停了')
  if (!svc.isReady('fair_visit_plan')) pass('反连坐: 仍在继承的子键随父键停用（继承语义正确）')
  else fail('反连坐: 仍在继承的子键未随父键停用')
  svc.update({ enabled: true }, PARENT)

  // ─── 8. 重启后不丢 ───────────────────────────────────────────────────────
  const svc2 = new LlmConfigService()
  if (svc2.getApiKey('job_fit') === 'sk-jobfit-0001') pass('持久化: 重启后 job_fit 独立 apiKey 仍在')
  else fail('持久化: 重启后 job_fit 独立配置丢失')
  if (svc2.getView('job_fit').inheritedFrom === null) pass('持久化: 重启后 job_fit 仍是独立配置')
  else fail('持久化: 重启后 job_fit 退回继承')
  if (svc2.getView('fair_visit_plan').inheritedFrom === PARENT) pass('持久化: 重启后未配置的子键仍在继承')
  else fail('持久化: 重启后继承关系丢失')
  if (svc2.getApiKey('fair_visit_plan') === svc2.getApiKey(PARENT)) pass('持久化: 重启后继承的 apiKey 仍指向父键')
  else fail('持久化: 重启后继承的 apiKey 不正确')

  // 密钥仍然只以密文落盘（拆键不得削弱既有加密约束）
  const fileText = readFileSync(CONFIG_FILE, 'utf-8')
  if (!fileText.includes('sk-jobfit-0001') && !fileText.includes('sk-parent-0001')) pass('安全: 配置文件不含 apiKey 明文')
  else fail('安全: 配置文件出现 apiKey 明文')
  for (const key of SPLIT_KEYS) {
    const view = svc2.getView(key) as unknown as Record<string, unknown>
    if (!('apiKeyEncrypted' in view) && !('explicitlyConfigured' in view)) continue
    fail(`安全: getView(${key}) 泄漏内部字段`)
  }
  pass('安全: getView 不下发 apiKeyEncrypted / explicitlyConfigured')

  // ─── 9. 历史配置文件向后兼容 ─────────────────────────────────────────────
  // 模拟拆键前写下的文件：7 个老键、全部没有 explicitlyConfigured 字段。
  const LEGACY_DIR = mkdtempSync(join(tmpdir(), 'vafk-legacy-'))
  const legacyPrev = process.env['FILE_STORAGE_DIR']
  try {
    const legacy = JSON.parse(fileText) as Record<string, Record<string, unknown>>
    const trimmed: Record<string, Record<string, unknown>> = {}
    for (const key of ['assistant_chat', 'resume_diagnosis', 'resume_generate', 'resume_optimize', 'mock_interview', 'digital_human', 'poster_generation']) {
      if (!legacy[key]) continue
      const { explicitlyConfigured: _drop, ...rest } = legacy[key]
      trimmed[key] = rest
    }
    writeFileSync(join(LEGACY_DIR, 'ai-model-configs.json'), JSON.stringify(trimmed, null, 2), 'utf-8')
    process.env['FILE_STORAGE_DIR'] = LEGACY_DIR
    const svc3 = new LlmConfigService()
    if (svc3.getView(PARENT).inheritedFrom === null) pass('兼容: 老配置文件里的老键不受继承逻辑影响')
    else fail('兼容: 老键被误判为继承')
    if (svc3.getApiKey(PARENT) === 'sk-parent-0001') pass('兼容: 老配置文件的 apiKey 仍可解密')
    else fail('兼容: 老配置文件的 apiKey 解密失败')
    for (const key of SPLIT_KEYS) {
      if (svc3.getView(key).inheritedFrom === PARENT) continue
      fail(`兼容: 老配置文件下 ${key} 未回落到继承`)
    }
    pass('兼容: 老配置文件下 6 个新键全部继承父键（默认行为不变）')
  } finally {
    process.env['FILE_STORAGE_DIR'] = legacyPrev
    rmSync(LEGACY_DIR, { recursive: true, force: true })
  }

  // ─── 10. 静态：消费方接线 ───────────────────────────────────────────────
  const consumers: Array<[string, string, string]> = [
    ['src/ai/resume/llm-job-fit.service.ts', 'job_fit', '岗位匹配'],
    ['src/ai/resume/llm-career-plan.service.ts', 'career_plan', '职业规划'],
    ['src/ai/resume/llm-fair-visit-plan.service.ts', 'fair_visit_plan', '招聘会拜访计划'],
    ['src/ai/resume/llm-self-assessment.service.ts', 'self_assessment', '自我探索解读'],
  ]
  for (const [rel, key, label] of consumers) {
    const src = read(rel)
    assertContains(src, `getApiKey('${key}')`, `接线: ${label} 用自己的 key`)
    assertNotContains(src, /get(ApiKey|Config)\('resume_optimize'\)/u, `接线: ${label} 不再读 resume_optimize`)
  }

  const jobAi = read('src/job-ai/job-ai-llm.service.ts')
  assertContains(jobAi, "'jobRecommend' ? 'job_recommend' : 'job_explain'", '接线: 岗位推荐/解读按 operation 分键')
  assertNotContains(jobAi, /get(ApiKey|Config)\('resume_optimize'\)/u, '接线: 岗位 AI 不再读 resume_optimize')

  // 简历优化 / 版式调整是本键的名义归属，必须仍留在 resume_optimize
  const optimize = read('src/ai/resume/llm-resume-optimize.service.ts')
  assertContains(optimize, "getApiKey('resume_optimize')", '接线: 简历优化仍留在 resume_optimize（名义归属不变）')

  // 注释修正：此前漏登记自我探索
  const configSrc = read('src/ai/llm/llm-config.service.ts')
  assertContains(configSrc, 'llm-self-assessment.service.ts', '注释: 共用键清单补上了自我探索')
  assertContains(configSrc, '7 个用户可见能力', '注释: 数量由 6 修正为 7')
}

try {
  console.log('\n=== S0-3 AI 功能位拆键验证（风险 R3）===')
  main()
} catch (error) {
  fail(`验证异常: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  rmSync(DATA_DIR, { recursive: true, force: true })
}

console.log(`\nS0-3 AI 功能位拆键验证: ${passCount} PASS, ${failCount} FAIL`)
if (failCount > 0) process.exit(1)
