/**
 * 招聘会 AI 参会准备单防回退验证。
 *
 * 该脚本做源码级门禁，确保 P1 闭环存在且不越过招聘合规边界：
 * - 后端必须提供 fair_visit_plan 的 controller/service/llm/pdf。
 * - 结果必须写 AiResumeResult(kind='fair_visit_plan')，并进入会员 AI 记录。
 * - PDF 必须通过 FilesService.upload 生成真实 FileObject 后进入打印链路。
 * - 代码中不得出现匹配百分比、录用概率、平台投递等招聘闭环语义。
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

let failed = 0
function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string) { failed += 1; console.error(`  FAIL ${message}`) }

function read(rel: string): string {
  const path = join(ROOT, rel)
  if (!existsSync(path)) {
    fail(`文件缺失: ${rel}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function mustContain(rel: string, markers: string[], label: string) {
  const src = read(rel)
  const missing = markers.filter((m) => !src.includes(m))
  if (missing.length > 0) fail(`${label}: 缺少 ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(rel: string, patterns: RegExp[], label: string) {
  const src = read(rel).replace(/const BLOCKED = \[[\s\S]*?\] as const/, '')
  const hits = patterns.filter((p) => p.test(src)).map(String)
  if (hits.length > 0) fail(`${label}: 命中 ${hits.join(' | ')}`)
  else pass(label)
}

console.log('\n=== 招聘会 AI 参会准备单防回退验证 ===')

mustContain(
  'src/ai/fair-visit-plan.controller.ts',
  ["@Controller('job-fairs/:fairId/visit-plan')", 'generate', 'latest', 'print'],
  '1. Controller 暴露招聘会 AI 参会准备单路由',
)

mustContain(
  'src/ai/resume/fair-visit-plan.service.ts',
  [
    "kind: 'fair_visit_plan'",
    'reviewStatus: \'approved\'',
    'publishStatus: \'published\'',
    'loadAuthorizedParse',
    'extractResumeText',
    'files.upload',
    'signFileUrl',
    'printFileUrl',
    'fair.visit_plan',
  ],
  '2. Service 基于已发布招聘会 + 本人简历生成、落库、审计、打印',
)

mustContain(
  'src/ai/resume/llm-fair-visit-plan.service.ts',
  ['LlmFairVisitPlanService', '仅供本人参会准备参考', 'sourceUrl', 'fairCompanies', 'AI_FAIR_VISIT_PLAN_FAILED'],
  '3. LLM 服务有来源上下文与失败码',
)

mustContain(
  'src/ai/resume/fair-visit-plan-pdf.service.ts',
  ['FairVisitPlanPdfService', '招聘会参会准备单', '仅供本人参会准备参考'],
  '4. PDF 服务真实生成参会准备单',
)

mustContain(
  'src/ai/ai.module.ts',
  ['FairVisitPlanController', 'FairVisitPlanService', 'LlmFairVisitPlanService', 'FairVisitPlanPdfService'],
  '5. AiModule 已挂载 controller/providers',
)

mustContain(
  'src/member-assets/member-assets.service.ts',
  ["r.kind === 'fair_visit_plan'"],
  '6. 会员 AI 服务记录识别 fair_visit_plan',
)

const banned = [
  /\d{1,3}\s*%/,
  /匹配度|匹配率|录用概率|录用率|保录用|保面试|推荐给企业/,
  /一键投递|立即投递|平台投递|投递简历/,
]
for (const rel of [
  'src/ai/resume/fair-visit-plan.service.ts',
  'src/ai/resume/llm-fair-visit-plan.service.ts',
  'src/ai/resume/fair-visit-plan-pdf.service.ts',
  'src/ai/fair-visit-plan.controller.ts',
]) {
  mustNotContain(rel, banned, `合规禁词扫描 ${rel}`)
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
