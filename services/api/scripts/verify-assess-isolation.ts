// ============================================================
// verify:assess-isolation
//
// 合规门禁：自我探索 · 倾向参考（kind='self_assessment'）结果不得参与
//   - JobFitService（岗位匹配参考）
//   - LlmResumeService（简历解析 / 优化 / 生成）
//   - PolicyMatcher（政策匹配）
//   - AssistantService / LlmAssistantService / AssistantController（AI 助手）
//   - 任何 form/listing/sort 路径
//
// 通过规则：
//   1) 服务端源码仅允许在以下文件直接引用 'self_assessment' 字面量：
//        - self-assessment*.service.ts / .controller.ts / .module.ts
//        - appended-self-assessment.service.ts（合并 PDF）
//        - career-plan.service.ts（基于职业规划的 basedOn 上下文 hint，不参与签名门禁 / 校验 / 配额）
//        - member-assets.service.ts / member-assets.types.ts（AI 服务记录归属本人）
//        - llm/llm-config.service.ts（AiModelFeatureKey 配置位，只配模型/密钥/开关，
//          不读 AiResumeResult；由 CONFIG_ONLY_FILES 反向断言守住）
//   2) JobFit / LlmResume / PolicyMatcher / Assistant 相关源文件不得出现 'self_assessment' 字面量。
//   3) AiResumeResult.kind 枚举白名单在 packages/shared 中含 self_assessment，
//      而前两类业务文件不能读取该 kind 行。
//
// 退出码：0 通过；非 0 失败。
// ============================================================

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')

// ─── 配置 ──────────────────────────────────────────────────────────

/** 允许直接出现 'self_assessment' 字面量的服务端源文件（相对 services/api）。 */
const ALLOWED_SELF_ASSESSMENT_FILES = new Set<string>([
  'src/ai/resume/self-assessment.service.ts',
  'src/ai/resume/self-assessment-pdf.service.ts',
  'src/ai/resume/llm-self-assessment.service.ts',
  'src/ai/resume/appended-self-assessment.service.ts',
  'src/ai/resume/career-plan.service.ts',
  'src/ai/resume/self-assessment.types.ts',
  'src/ai/resume/self-assessment-questions.ts',
  'src/ai/self-assessment.controller.ts',
  'src/ai/ai.module.ts',
  'src/member-assets/member-assets.service.ts',
  'src/member-assets/member-assets.types.ts',
  'src/audit/audit.types.ts',
  // #617 S0-3：'self_assessment' 在本文件里是 AiModelFeatureKey（模型厂商 / 密钥 / 开关的
  // 配置位），与本门禁看管的 AiResumeResult.kind 是两个命名空间。拆键的目的正是让自我探索
  // 解读脱离 resume_optimize 单点，属于加强隔离而不是打开读路径。
  // 该文件不得读取自我探索结果 —— 由下面的 CONFIG_ONLY_FILES 断言单独守住。
  'src/ai/llm/llm-config.service.ts',
])

/**
 * 允许出现 'self_assessment' 字面量、但只能作为配置键的文件：
 * 一旦它们开始读取 AiResumeResult，白名单豁免立即失效。
 */
const CONFIG_ONLY_FILES = new Set<string>(['src/ai/llm/llm-config.service.ts'])

/** 不得引用 'self_assessment' 字面量的服务端源文件（直接来源链路）。 */
const FORBIDDEN_DIRECT_TOUCH = new Set<string>([
  'src/ai/resume/job-fit.service.ts',
  'src/ai/resume/llm-resume.service.ts',
  'src/policies/policies.service.ts',
  'src/ai/ai.controller.ts',
  'src/ai/ai.service.ts',
  'src/ai/ai-log.service.ts',
  'src/ai/ai-result.cleanup.task.ts',
  'src/job-ai/job-ai.service.ts',
])

const TARGET_DIRECTORIES = [
  join(REPO_ROOT, 'services', 'api', 'src'),
]

// ─── 工具函数 ──────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
      walk(full, out)
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function relativeToApi(absPath: string): string {
  const rel = relative(join(REPO_ROOT, 'services', 'api'), absPath)
  return rel.split(sep).join('/')
}

function isInTarget(absPath: string): boolean {
  return TARGET_DIRECTORIES.some((root) => absPath.startsWith(root))
}

// ─── 主验证逻辑 ────────────────────────────────────────────────────

const violations: { file: string; line: number; snippet: string; rule: string }[] = []

for (const root of TARGET_DIRECTORIES) {
  for (const file of walk(root)) {
    if (!isInTarget(file)) continue
    const rel = relativeToApi(file)
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, idx) => {
      if (!line.includes("'self_assessment'") && !line.includes('"self_assessment"')) return
      const lineNo = idx + 1
      const snippet = line.trim().slice(0, 160)
      if (FORBIDDEN_DIRECT_TOUCH.has(rel)) {
        violations.push({ file: rel, line: lineNo, snippet, rule: 'FORBIDDEN_DIRECT_TOUCH' })
        return
      }
      if (!ALLOWED_SELF_ASSESSMENT_FILES.has(rel)) {
        // 任何未列入白名单的服务端文件出现 self_assessment 字面量均视为可疑
        // （避免后续误开放读路径）。
        violations.push({ file: rel, line: lineNo, snippet, rule: 'NOT_ALLOWED_FILE' })
      }
    })
  }
}

// 配置位豁免的代价必须付：这些文件只准把 'self_assessment' 当配置键，
// 一旦读起 AiResumeResult（自我探索结果所在表），豁免作废。
for (const rel of CONFIG_ONLY_FILES) {
  const abs = join(REPO_ROOT, 'services', 'api', rel)
  const text = readFileSync(abs, 'utf8')
  text.split(/\r?\n/).forEach((line, idx) => {
    if (!/aiResumeResult|AiResumeResult/.test(line)) return
    violations.push({
      file: rel,
      line: idx + 1,
      snippet: line.trim().slice(0, 160),
      rule: 'CONFIG_ONLY_FILE_MUST_NOT_READ_RESULTS',
    })
  })
}

try {
  // 注意：node:assert 的 message 参数只接受 string | Error，传函数会被原样 stringify，
  // 违规明细一行都印不出来。必须先拼好字符串。
  assert.equal(
    violations.length,
    0,
    [
      'verify:assess-isolation failed:',
      ...violations.map((v) => `  - [${v.rule}] ${v.file}:${v.line}  ${v.snippet}`),
    ].join('\n'),
  )
  // eslint-disable-next-line no-console
  console.log(`verify:assess-isolation: PASS (scanned ${TARGET_DIRECTORIES.length} trees, no isolation violations)`)
  process.exit(0)
} catch (err) {
  // eslint-disable-next-line no-console
  console.error((err as Error).message)
  process.exit(1)
}