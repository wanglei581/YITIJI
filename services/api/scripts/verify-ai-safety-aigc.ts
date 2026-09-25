/**
 * 3.5c：提示词安全句、导出文件显式标识与隐式 AIGC。
 *
 * 期望值来自 docs/reviews/2026-09-26-ai-label-copy-prompt-audit.md，
 * 不是从改完后的输出抄出来的。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:ai-safety-aigc
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { createRequire } from 'module'
import {
  AI_SAFETY_NO_DISCRIMINATION,
  AI_SAFETY_NO_FABRICATION,
} from '../src/ai/llm/ai-prompt-safety'
import { buildGuardedSystemPrompt, DEFAULT_ROLE_SCOPE } from '../src/ai/llm/llm-guard'
import { DEFAULT_SYSTEM_PROMPT } from '../src/ai/llm/llm-config.service'
import { TRTC_DEFAULT_SYSTEM_PROMPT } from '../src/trtc/trtc.service'
import { assistantSkillPrompts } from '../src/ai/llm/llm-chat.service'
import { JOB_FIT_SYSTEM_PROMPT } from '../src/ai/resume/llm-job-fit.service'
import { JOB_AI_EXPLAIN_SYSTEM_PROMPT, JOB_AI_RECOMMEND_SYSTEM_PROMPT } from '../src/job-ai/job-ai-llm.service'
import { CAREER_PLAN_SYSTEM_PROMPT } from '../src/ai/resume/llm-career-plan.service'
import { buildSystemPrompt } from '../src/ai/resume/llm-fair-visit-plan.service'
import {
  interviewQuestionSystemPrompt,
  interviewReportSystemPrompt,
} from '../src/mock-interview/mock-interview-llm.service'
import { DIAGNOSIS_RETRY_HINT, DIAGNOSIS_SYSTEM_PROMPT } from '../src/ai/resume/llm-resume.service'
import {
  LAYOUT_ADJUST_RETRY_HINT,
  LAYOUT_ADJUST_SYSTEM_PROMPT,
  OPTIMIZE_RETRY_HINT,
  OPTIMIZE_SYSTEM_PROMPT,
} from '../src/ai/resume/llm-resume-optimize.service'
import { GENERATE_RETRY_HINT, GENERATE_SYSTEM_PROMPT } from '../src/ai/resume/llm-resume-generate.service'
import { SELF_ASSESSMENT_SYSTEM_PROMPT } from '../src/ai/resume/llm-self-assessment.service'
import { ADVISOR_DRAFT_SYSTEM_PROMPT, ADVISOR_QA_SYSTEM_PROMPT } from '../src/advisor/llm-advisor.service'
import { ASSISTANT_SUMMARY_SYSTEM_PROMPT } from '../src/advisor/assistant-summary.service'
import { SYSTEM_PROMPT as CONTRACT_SYSTEM_PROMPT } from '../src/contract-review/contract-review-provider.service'
import { JobFitPdfService } from '../src/ai/resume/job-fit-pdf.service'
import { CareerPlanPdfService } from '../src/ai/resume/career-plan-pdf.service'
import { FairVisitPlanPdfService } from '../src/ai/resume/fair-visit-plan-pdf.service'
import { SelfAssessmentPdfService } from '../src/ai/resume/self-assessment-pdf.service'
import { InterviewReportPdfService } from '../src/mock-interview/interview-report-pdf.service'
import { AdvisorPdfService } from '../src/advisor/advisor-pdf.service'
import { ContractReviewReportPdfService } from '../src/contract-review/contract-review-report-pdf.service'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { ResumeDocxService } from '../src/ai/resume/resume-docx.service'
import { CareerPlanDegradedPdfService } from '../src/ai/resume/career-plan-degraded-pdf.service'
import { InterviewPracticeSheetPdfService } from '../src/mock-interview/interview-practice-sheet-pdf.service'
import {
  AIGC_DEFAULT_PRODUCER,
  appendAigcPages,
  buildAigcLabelJson,
  parseAigcLabelJson,
  readPdfInfo,
} from '../src/common/pdf/aigc-label'

const SRC = join(__dirname, '../src')
const unpdf = require('unpdf') as {
  getDocumentProxy: (data: Uint8Array) => Promise<unknown>
  extractText: (pdf: unknown, options: { mergePages: boolean }) => Promise<{ text: string | string[] }>
}

let failed = 0
function pass(id: string) { console.log(`  ASSERT ${id} PASS`) }
function fail(id: string, detail: string) {
  failed += 1
  console.error(`  ASSERT ${id} FAIL ${detail}`)
}

/** 审计表第 83–95 行：两句必须原样在提示词里，缺一句就不能拦住编造或六类区别对待。 */
function expectSafety(id: string, text: string) {
  if (!text.includes(AI_SAFETY_NO_FABRICATION)) fail(id, '缺少「不得编造学历、工作经历或证书。」（审计表 83–95）')
  else if (!text.includes(AI_SAFETY_NO_DISCRIMINATION)) fail(id, '缺少六类公平就业完整句（审计表 83–95）')
  else pass(id)
}

function squash(value: string): string {
  return value.replace(/\s+/gu, '')
}

async function visiblePages(buffer: Buffer): Promise<string[]> {
  const doc = await unpdf.getDocumentProxy(new Uint8Array(buffer))
  const extracted = await unpdf.extractText(doc, { mergePages: false })
  return Array.isArray(extracted.text) ? extracted.text : [extracted.text]
}

async function visibleText(buffer: Buffer): Promise<string> {
  return (await visiblePages(buffer)).join('\n')
}

const JOB_FIT_BANNED = [
  '参考等级',
  '准备程度较高',
  '匹配参考：较高',
  '岗位决策',
  '总评',
  '建议投递',
  '不能投',
  '录用概率',
]

const CONTRACT_PROMPT_REQUIRED = [
  '你不是律师',
  '本输出不构成法律意见',
  '不得判断合同是否有效',
  '不得写成律师审查结论',
]

const CONTRACT_PDF_BANNED = ['法律意见', '律师审查', '判断合同有效', '合同有效']

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'generated') continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walkTs(path, out)
    else if (name.endsWith('.ts')) out.push(path)
  }
  return out
}

const GUARD_CALL = /(?:^|[^\w$.])(?:withAiSafety|buildGuardedSystemPrompt|appendAiSafetySentences)\s*\(/

/** 读到逗号、分号或换行，但字符串和括号里的换行继续。续行以 + ? : 结尾时也继续。 */
function cutExpression(raw: string): string {
  let index = 0
  while (index < raw.length && /\s/u.test(raw[index] ?? '')) index += 1
  const start = index
  let depth = 0
  let quote: string | null = null
  for (; index < raw.length; index += 1) {
    const ch = raw[index] ?? ''
    if (quote) {
      if (ch === '\\') { index += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return raw.slice(start, index).trim()
      depth -= 1
    } else if (depth === 0 && (ch === ',' || ch === ';')) {
      return raw.slice(start, index).trim()
    } else if (depth === 0 && ch === '\n') {
      const soFar = raw.slice(start, index).trim()
      if (soFar.length > 0 && !/[+\-?:&|=]$/u.test(soFar)) return soFar
    }
  }
  return raw.slice(start).trim()
}

function systemContents(src: string): Array<{ line: number; index: number; expr: string }> {
  const out: Array<{ line: number; index: number; expr: string }> = []
  const roleRe = /role\s*:\s*(['"])system\1(?!\s*\|)/g
  for (const match of src.matchAll(roleRe)) {
    const at = match.index ?? 0
    const after = src.slice(at + match[0].length, at + match[0].length + 400)
    const content = /^\s*(?:as\s+const\s*)?,\s*content\s*:\s*/.exec(after)
    if (!content) continue
    const expr = cutExpression(after.slice(content[0].length))
    if (!expr || expr === 'string') continue
    out.push({ line: src.slice(0, at).split('\n').length, index: at, expr })
  }
  return out
}

function splitTernary(expr: string): { whenTrue: string; whenFalse: string } | null {
  let depth = 0
  let quote: string | null = null
  let mark = -1
  for (let index = 0; index < expr.length; index += 1) {
    const ch = expr[index] ?? ''
    if (quote) {
      if (ch === '\\') { index += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    else if (depth === 0 && ch === '?' && expr[index + 1] !== '.' && expr[index + 1] !== '?') mark = index
    else if (depth === 0 && ch === ':' && mark >= 0) {
      return { whenTrue: expr.slice(mark + 1, index).trim(), whenFalse: expr.slice(index + 1).trim() }
    }
  }
  return null
}

function bindingsOf(name: string, src: string): string[] {
  const re = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]+)?=\\s*`, 'g')
  return [...src.matchAll(re)].map((match) => cutExpression(src.slice((match.index ?? 0) + match[0].length)))
}

function nearestParamFunction(src: string, index: number, name: string): string | null {
  const re = new RegExp(`(\\w+)\\s*\\(\\s*${name}\\s*:`, 'g')
  let found: string | null = null
  let foundAt = -1
  for (const match of src.matchAll(re)) {
    const at = match.index ?? 0
    if (at < index && index - at < 12000 && at > foundAt) {
      found = match[1] ?? null
      foundAt = at
    }
  }
  return found
}

function callArgsOf(src: string, name: string): Array<{ index: number; expr: string }> {
  const re = new RegExp(`(?:^|[^\\w])(?:this\\.)?${name}\\s*\\(`, 'g')
  const out: Array<{ index: number; expr: string }> = []
  for (const match of src.matchAll(re)) {
    const at = (match.index ?? 0) + match[0].length
    const expr = cutExpression(src.slice(at))
    if (/^\w+\s*:/u.test(expr)) continue
    out.push({ index: at, expr })
  }
  return out
}

function functionReturns(name: string, src: string): string[] {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{`)
  const match = re.exec(src)
  if (!match || match.index === undefined) return []
  const bodyStart = match.index + match[0].length - 1
  let depth = 0
  let bodyEnd = bodyStart
  let quote: string | null = null
  for (let index = bodyStart; index < src.length; index += 1) {
    const ch = src[index] ?? ''
    if (quote) {
      if (ch === '\\') { index += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { bodyEnd = index; break }
    }
  }
  const body = src.slice(bodyStart + 1, bodyEnd)
  return [...body.matchAll(/return\s+/g)].map((item) => cutExpression(body.slice((item.index ?? 0) + item[0].length)))
}

function expressionGuarded(expr: string, src: string, index: number, depth = 0, seen: string[] = []): boolean {
  if (depth > 12) return false
  const text = expr.trim()
  if (!text) return false
  if (GUARD_CALL.test(text)) return true
  if (text.includes(AI_SAFETY_NO_FABRICATION) && text.includes(AI_SAFETY_NO_DISCRIMINATION)) return true
  const ternary = splitTernary(text)
  if (ternary) {
    return expressionGuarded(ternary.whenTrue, src, index, depth + 1, seen)
      && expressionGuarded(ternary.whenFalse, src, index, depth + 1, seen)
  }
  if (text.startsWith('`') && text.endsWith('`')) {
    const holes = [...text.matchAll(/\$\{([^}]+)\}/g)].map((item) => item[1]?.trim() ?? '')
    return holes.some((hole) => expressionGuarded(hole, src, index, depth + 1, seen))
  }
  const call = /^([A-Za-z_$][\w$]*)\s*\(/u.exec(text)
  if (call && call[1] && !['withAiSafety', 'buildGuardedSystemPrompt', 'appendAiSafetySentences'].includes(call[1])) {
    const returns = functionReturns(call[1], src)
    return returns.length > 0 && returns.every((item) => expressionGuarded(item, src, index, depth + 1, seen))
  }
  if (!/^[A-Za-z_$][\w$]*$/u.test(text) || seen.includes(text)) return false
  const paramFn = nearestParamFunction(src, index, text)
  if (paramFn) {
    const args = callArgsOf(src, paramFn)
    // 实参和形参可以同名。这里跟的是调用点上的表达式，不能把形参名记成已访问。
    return args.length > 0 && args.every((arg) => expressionGuarded(arg.expr, src, arg.index, depth + 1, seen))
  }
  const bindings = bindingsOf(text, src)
  return bindings.length > 0 && bindings.every((item) => expressionGuarded(item, src, index, depth + 1, [...seen, text]))
}

async function main(): Promise<void> {
  delete process.env['AIGC_CONTENT_PRODUCER']

  const prompts: Array<[string, string]> = [
    ['prompt:job-fit', JOB_FIT_SYSTEM_PROMPT],
    ['prompt:job-ai-recommend', JOB_AI_RECOMMEND_SYSTEM_PROMPT],
    ['prompt:job-ai-explain', JOB_AI_EXPLAIN_SYSTEM_PROMPT],
    ['prompt:career-plan', CAREER_PLAN_SYSTEM_PROMPT],
    ['prompt:fair-review', buildSystemPrompt('review')],
    ['prompt:fair-prep', buildSystemPrompt('preparation')],
    ['prompt:interview-question', interviewQuestionSystemPrompt({
      interviewerType: 'hr', industry: '互联网', position: '后端', experience: '应届', difficulty: 'standard', askedCount: 0, questionTarget: 3,
    })],
    ['prompt:interview-report', interviewReportSystemPrompt({
      interviewerType: 'hr', industry: '互联网', position: '后端', experience: '应届', difficulty: 'standard',
    })],
    ['prompt:diagnosis', DIAGNOSIS_SYSTEM_PROMPT],
    ['prompt:diagnosis-retry', DIAGNOSIS_RETRY_HINT],
    ['prompt:optimize', OPTIMIZE_SYSTEM_PROMPT],
    ['prompt:optimize-retry', OPTIMIZE_RETRY_HINT],
    ['prompt:layout', LAYOUT_ADJUST_SYSTEM_PROMPT],
    ['prompt:layout-retry', LAYOUT_ADJUST_RETRY_HINT],
    ['prompt:generate', GENERATE_SYSTEM_PROMPT],
    ['prompt:generate-retry', GENERATE_RETRY_HINT],
    ['prompt:self-assessment', SELF_ASSESSMENT_SYSTEM_PROMPT],
    ['prompt:advisor-qa', ADVISOR_QA_SYSTEM_PROMPT],
    ['prompt:advisor-draft', ADVISOR_DRAFT_SYSTEM_PROMPT],
    ['prompt:assistant-summary', ASSISTANT_SUMMARY_SYSTEM_PROMPT],
    ['prompt:contract', CONTRACT_SYSTEM_PROMPT],
    ['prompt:assistant-default', DEFAULT_SYSTEM_PROMPT],
    ['prompt:trtc-default', TRTC_DEFAULT_SYSTEM_PROMPT],
    ...assistantSkillPrompts().map((text, index): [string, string] => [`prompt:assistant-skill-${index}`, text]),
  ]
  for (const [id, text] of prompts) expectSafety(id, text)

  // 审计表第 95 行：自定义提示词经护栏后仍必须带着两句，而且两句在自定义文本之后。
  const custom = '自定义提示，请只回答你好。'
  const guarded = buildGuardedSystemPrompt({ systemPrompt: custom, roleScope: '随便写的范围', forbiddenWords: [] })
  const customAt = guarded.indexOf(custom)
  const safetyAt = guarded.lastIndexOf(AI_SAFETY_NO_FABRICATION)
  if (customAt < 0 || safetyAt < customAt || !guarded.includes(AI_SAFETY_NO_DISCRIMINATION)) {
    fail('guard:custom', '自定义提示词可以删掉安全句（审计表第 95 行）')
  } else pass('guard:custom')

  // 审计表第 95 行：默认人设改为简历、打印与政策说明，不再把云上岗位和招聘会写成查询入口。
  const persona = `${DEFAULT_ROLE_SCOPE}\n${DEFAULT_SYSTEM_PROMPT}\n${TRTC_DEFAULT_SYSTEM_PROMPT}`
  if (persona.includes('岗位/招聘会信息查询引导') || persona.includes('第三方岗位信息入口') || persona.includes('招聘会信息入口')) {
    fail('persona:scope', '默认人设仍在引导查询云上岗位或招聘会（审计表第 95 行）')
  } else if (!DEFAULT_ROLE_SCOPE.includes('简历') || !DEFAULT_ROLE_SCOPE.includes('打印') || !DEFAULT_ROLE_SCOPE.includes('政策说明')) {
    fail('persona:scope', '默认角色范围没有收成简历、打印与政策说明（审计表第 95 行）')
  } else pass('persona:scope')

  // 审计表第 94 行：合同审查提示词必须自己写明这四句。
  const missingContract = CONTRACT_PROMPT_REQUIRED.filter((phrase) => !CONTRACT_SYSTEM_PROMPT.includes(phrase))
  if (missingContract.length > 0) fail('contract:prompt', `缺少 ${missingContract.join('、')}（审计表第 94 行）`)
  else pass('contract:prompt')

  // 审计表第 63–64、104 行：简历对照提示词不得再要求档位、总评或投递倾向。
  const jobFitHits = JOB_FIT_BANNED.filter((phrase) => JOB_FIT_SYSTEM_PROMPT.includes(phrase))
  if (jobFitHits.length > 0) fail('jobfit:prompt-banned', `提示词仍含 ${jobFitHits.join('、')}（审计表第 63–64、104 行）`)
  else pass('jobfit:prompt-banned')
  if (CAREER_PLAN_SYSTEM_PROMPT.includes('为什么适合') || buildSystemPrompt('preparation').includes('为什么适合')) {
    fail('tendency:prompt', '职业规划或参会准备仍要求「为什么适合」（审计表第 85–86 行）')
  } else if (buildSystemPrompt('review').includes('值得跟进') || buildSystemPrompt('preparation').includes('值得跟进')) {
    fail('tendency:prompt', '参会准备仍要求「值得跟进」（审计表第 86 行）')
  } else pass('tendency:prompt')

  // 审计表第 95 行：同一文件里每一个送给模型的 system 都要过护栏。一个包了、一个没包，必须红。
  for (const file of walkTs(SRC)) {
    const src = readFileSync(file, 'utf8')
    const sites = systemContents(src)
    if (sites.length === 0) continue
    const rel = file.slice(SRC.length + 1)
    const bare = sites.filter((site) => !expressionGuarded(site.expr, src, site.index))
    if (bare.length > 0) {
      fail(`walk:${rel}`, `第 ${bare.map((site) => site.line).join('、')} 行的 system 没有护栏，也没有两句安全句（审计表第 95、106 行）`)
    } else pass(`walk:${rel}`)
  }

  process.env['AIGC_CONTENT_PRODUCER'] = '91310000MA1TESTCODE'
  const overridden = parseAigcLabelJson(buildAigcLabelJson('task-env'))
  if (overridden?.ContentProducer !== '91310000MA1TESTCODE' || overridden.ContentPropagator !== overridden.ContentProducer) {
    fail('aigc:env', 'AIGC_CONTENT_PRODUCER 未进入 ContentProducer（next-tasks 第 4 条）')
  } else pass('aigc:env')
  delete process.env['AIGC_CONTENT_PRODUCER']
  const fallback = parseAigcLabelJson(buildAigcLabelJson('task-default'))
  if (fallback?.ContentProducer !== AIGC_DEFAULT_PRODUCER) {
    fail('aigc:default-producer', `未设置环境变量时应为「${AIGC_DEFAULT_PRODUCER}」`)
  } else pass('aigc:default-producer')

  const produceIdRejected = (value: string): boolean => {
    try {
      buildAigcLabelJson(value)
      return false
    } catch (error) {
      return error instanceof Error && error.message.includes('ProduceID')
    }
  }
  if (!produceIdRejected('')) fail('aigc:produce-id-empty', '空 ProduceID 仍能写入')
  else pass('aigc:produce-id-empty')
  if (!produceIdRejected(' \n\t ')) fail('aigc:produce-id-blank', '纯空白 ProduceID 仍能写入')
  else pass('aigc:produce-id-blank')
  const labelShell = {
    Label: '1',
    ContentProducer: AIGC_DEFAULT_PRODUCER,
    ReservedCode1: '',
    ContentPropagator: AIGC_DEFAULT_PRODUCER,
    ReservedCode2: '',
  }
  if (parseAigcLabelJson(JSON.stringify({ ...labelShell, ProduceID: '', PropagateID: '' })) !== null) {
    fail('aigc:parse-produce-id-empty', '空 ProduceID 被当成合法标识')
  } else pass('aigc:parse-produce-id-empty')
  if (parseAigcLabelJson(JSON.stringify({ ...labelShell, ProduceID: '   ', PropagateID: '   ' })) !== null) {
    fail('aigc:parse-produce-id-blank', '纯空白 ProduceID 被当成合法标识')
  } else pass('aigc:parse-produce-id-blank')
  // GB 45438-2025 附录 E c)2：Label 是字符串。整数 1 不是合法标识。
  if (parseAigcLabelJson(JSON.stringify({ ...labelShell, Label: 1, ProduceID: 'task-1', PropagateID: 'task-1' })) !== null) {
    fail('aigc:label-string', 'Label 整数 1 不符合附录 E 的字符串类型')
  } else pass('aigc:label-string')

  // 短文通常只有一页。应标识的 PDF 必须长到至少两页，才能抓住第二页丢掉的页眉。
  const sample = '这是一段仅用于把应标识报告撑到第二页的示例内容。'.repeat(120)
  const renders: Array<{ id: string; produceId: string; buffer: Buffer; wantVisible: boolean }> = []
  renders.push({
    id: 'job-fit',
    produceId: 'task-jobfit',
    wantVisible: true,
    buffer: (await new JobFitPdfService().render(
      {
        date: '2026-09-26',
        contentId: 'task-jobfit',
        job: { id: 'job-1', title: '后端开发', company: '示例公司', sourceName: '来源平台', sourceUrl: null, externalId: 'ext-1' },
        decisionSupport: undefined,
      },
      {
        summary: sample,
        matchPoints: [{ point: '已写到的一点', evidence: '原文' }],
        gapPoints: [{ gap: '还没写到的一点', suggestion: '补一句事实' }],
        targetedSuggestions: ['把已有项目写具体'],
      } as never,
    )).buffer,
  })
  renders.push({
    id: 'career-plan',
    produceId: 'task-career',
    wantVisible: true,
    buffer: (await new CareerPlanPdfService().render(
      { date: '2026-09-26', contentId: 'task-career', basedOn: { jobFit: null, interview: null } },
      {
        summary: sample,
        currentSnapshot: [{ point: '现状', evidence: '原文' }],
        directions: [{ title: '方向', why: '简历里写过的项目', firstStep: '先整理一段' }],
        skillPlan: [{ skill: '表达', action: '改一句', timeframe: '1-3 个月' }],
        actionChecklist: ['核对原文'],
      } as never,
    )).buffer,
  })
  renders.push({
    id: 'fair-visit',
    produceId: 'task-fair',
    wantVisible: true,
    buffer: (await new FairVisitPlanPdfService().render(
      { date: '2026-09-26', fairName: '示例招聘会', sourceName: '来源机构', venue: '示例会场', sourceUrl: 'https://example.com', contentId: 'task-fair' },
      {
        mode: 'preparation',
        summary: sample,
        fairHighlights: ['看点'],
        priorityCompanies: [{ companyName: '某企业', reason: '简历里写过相关项目', sourceUrl: null }],
        preparationChecklist: ['带上简历'],
        questionsToAsk: ['问清岗位原文'],
        onsiteTips: ['看展位图'],
      },
    )).buffer,
  })
  renders.push({
    id: 'self-assessment',
    produceId: 'task-self',
    wantVisible: true,
    buffer: (await new SelfAssessmentPdfService().render({
      date: '2026-09-26',
      contentId: 'task-self',
      summary: sample,
      dimensions: [{ key: 'interest', label: '兴趣偏好', strength: 3, note: sample, evidenceQuestionIdx: [] }] as never,
    })).buffer,
  })
  renders.push({
    id: 'interview',
    produceId: 'task-interview',
    wantVisible: true,
    buffer: (await new InterviewReportPdfService().render(
      { position: '后端开发', industry: '互联网', interviewerLabel: 'HR', date: '2026-09-26', contentId: 'task-interview' },
      {
        overall: { level: 'pass', summary: sample },
        expression: ['说清楚了'],
        positionFit: ['提到了项目'],
        credibility: ['有具体事'],
        professional: ['讲了职责'],
        adaptability: ['能接着说'],
        risks: ['可以再短一点'],
        predictedQuestions: [{ question: '再讲一个例子', why: '看结构', approach: '先说结果' }],
        starAdvice: { s: '情境', t: '任务', a: '行动', r: '结果', reminder: '用原文' },
        checklist: ['再看一遍简历'],
      } as never,
    )).buffer,
  })
  renders.push({
    id: 'advisor',
    produceId: 'task-advisor',
    wantVisible: true,
    buffer: (await new AdvisorPdfService().render(
      { date: '2026-09-26', providerLabel: 'mock', contentId: 'task-advisor' },
      { kind: 'qa_pins', pins: [{ content: sample, evidenceLevel: 'E1', sourceNote: '用户自己说的' }] },
    )).buffer,
  })
  renders.push({
    id: 'contract',
    produceId: 'task-contract',
    wantVisible: true,
    buffer: (await new ContractReviewReportPdfService().render({
      taskId: 'task-contract',
      generatedAt: new Date('2026-09-26T00:00:00Z'),
      result: {
        priorityCheckCount: 0,
        attentionCount: 0,
        insufficientInfoCount: 0,
        coverage: 'complete',
        ocrConfidence: 'high',
        disclaimerVersion: 'v1',
        rulePackVersion: 'v1',
        generatedByAi: true,
        findings: [1, 2, 3, 4, 5, 6].map((index) => ({
          id: `f-${index}`,
          category: 'term' as const,
          priority: 'attention' as const,
          title: `核对事项 ${index}`,
          evidence: { pageNumber: index, excerpt: sample.slice(0, 180), charStart: null, charEnd: null },
          explanation: sample.slice(0, 800),
          basisRef: null,
          verificationQuestion: '请对照合同原文核对此处。',
          uncertainty: '示例不确定性说明。',
          source: 'ai' as const,
        })),
      },
    })).buffer,
  })
  const resume = {
    basic: { name: '示例', phone: '', email: '', city: '' },
    intention: { position: '后端开发' },
    summary: sample,
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certificates: [],
  }
  renders.push({
    id: 'resume',
    produceId: 'task-resume',
    wantVisible: false,
    buffer: (await new ResumePdfService().render(resume as never, { contentId: 'task-resume' })).buffer,
  })

  for (const item of renders) {
    const text = squash(await visibleText(item.buffer))
    const info = await readPdfInfo(item.buffer)
    const aigc = parseAigcLabelJson(info['AIGC'] ?? '')
    if (item.wantVisible) {
      // 审计表第 11–36、103 行：每一页都要同时有「AI 生成」和「仅供参考」。合并全文会让第二页丢页眉也通过。
      const pages = await visiblePages(item.buffer)
      if (pages.length < 2) {
        fail(`pdf:${item.id}:pages`, `应标识的 PDF 只有 ${pages.length} 页，第二页页眉测不到`)
      } else {
        const missing = pages
          .map((page, index) => ({ index, text: squash(page) }))
          .filter((page) => !page.text.includes('AI生成') || !page.text.includes('仅供参考'))
        if (missing.length > 0) {
          fail(`pdf:${item.id}:visible`, `第 ${missing.map((page) => page.index + 1).join('、')} 页没有同时出现「AI 生成」和「仅供参考」`)
        } else pass(`pdf:${item.id}:visible`)
      }
    } else if (text.includes('AI生成') || text.includes('仅供参考')) {
      // 简历正文是否印标识待拍板（审计表第 15 行，本路明确先不做）。
      fail(`pdf:${item.id}:visible`, '简历 PDF 正文出现了可见标识，这一项还没拍板')
    } else pass(`pdf:${item.id}:no-visible`)
    if (!aigc || aigc.ProduceID !== item.produceId || aigc.ContentProducer !== AIGC_DEFAULT_PRODUCER) {
      fail(`pdf:${item.id}:aigc`, `Info 里没有合法 AIGC 或 ProduceID 不是任务号（next-tasks 第 4 条），实际 ${info['AIGC'] ?? '缺失'}`)
    } else pass(`pdf:${item.id}:aigc`)
  }

  const jobFitText = squash(await visibleText(renders.find((item) => item.id === 'job-fit')!.buffer))
  const jobFitPdfHits = JOB_FIT_BANNED.filter((phrase) => jobFitText.includes(squash(phrase)))
  if (jobFitPdfHits.length > 0 || !jobFitText.includes('简历对照')) {
    fail('jobfit:pdf-banned', `简历对照 PDF 仍有档位或决策字样：${jobFitPdfHits.join('、') || '标题不是简历对照'}（审计表第 63 行）`)
  } else pass('jobfit:pdf-banned')

  const selfText = squash(await visibleText(renders.find((item) => item.id === 'self-assessment')!.buffer))
  if (!selfText.includes(squash('这部分按规则计算，不是 AI 生成'))) {
    fail('self:rule-score', '规则打分段没有标明不是 AI 生成（审计表第 24 行）')
  } else pass('self:rule-score')

  const contractText = await visibleText(renders.find((item) => item.id === 'contract')!.buffer)
  const contractHits = CONTRACT_PDF_BANNED.filter((phrase) => contractText.includes(phrase))
  if (contractHits.length > 0 || !contractText.includes('AI 生成，仅作风险提示，请自行核对原文')) {
    fail('contract:pdf', `对外句子仍有 ${contractHits.join('、') || '没有替换句'}（审计表第 69 行）`)
  } else pass('contract:pdf')

  // 审计表第 39 行：题目单和降级 PDF 里面没有模型文字，不能写 AIGC，正文也不能出现「AI 生成」。
  const practice = await new InterviewPracticeSheetPdfService().render({
    date: '2026-09-26',
    position: '后端开发',
    industry: '互联网',
    interviewerLabel: 'HR',
    questions: [{ question: '请做一个自我介绍。', examines: '表达结构' }],
  })
  const degraded = await new CareerPlanDegradedPdfService().render({
    date: '2026-09-26',
    reason: { text: '本次没有可用的规划建议。' },
    selfAssessment: [],
    jobRequirementStats: null,
  })
  const draft = await new ResumePdfService().render(resume as never, { draft: true, contentId: 'task-draft' })
  for (const [id, buffer] of [
    ['practice', practice.buffer],
    ['degraded', degraded.buffer],
    ['resume-draft', draft.buffer],
  ] as const) {
    const text = squash(await visibleText(buffer))
    const info = await readPdfInfo(buffer)
    if (info['AIGC'] || info['AIGenerated'] !== 'false') fail(`pdf:${id}:honest`, '非 AI 文件写了 AIGC 或没有 AIGenerated=false（审计表第 39 行）')
    else if (text.includes('AI生成')) fail(`pdf:${id}:honest`, '正文出现了「AI 生成」（审计表第 39 行）')
    else pass(`pdf:${id}:honest`)
  }

  const docx = await new ResumeDocxService().render(resume as never, { contentId: 'task-resume-docx' })
  const docxRequire = createRequire(require.resolve('docx'))
  const JSZip = docxRequire('jszip') as {
    loadAsync: (buf: Buffer) => Promise<{ file: (name: string) => { async: (type: 'string') => Promise<string> } | null }>
  }
  const zip = await JSZip.loadAsync(docx.buffer)
  const customXml = await zip.file('docProps/custom.xml')?.async('string') ?? ''
  const body = await zip.file('word/document.xml')?.async('string') ?? ''
  const customMatch = customXml.match(/name="AIGC"[\s\S]*?<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/)
  const decoded = (customMatch?.[1] ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  const docxAigc = parseAigcLabelJson(decoded)
  if (!docxAigc || docxAigc.ProduceID !== 'task-resume-docx') {
    fail('docx:aigc', 'customProperties 没有合法 AIGC（next-tasks 第 4 条）')
  } else pass('docx:aigc')
  if (body.includes('AI 生成') || body.includes('仅供参考')) {
    fail('docx:body', '简历 DOCX 正文印了可见标识，这一项还没拍板（审计表第 16 行）')
  } else pass('docx:body')

  // 追加页保持原简历 Title，并把 AIGC.Label 置为 1。草稿原来 AIGenerated=false，追加后必须改成 true。
  const original = await PDFDocument.create()
  original.addPage()
  original.setTitle('原简历')
  const appendix = await PDFDocument.create()
  appendix.addPage()
  const appendixBuffer = Buffer.from(await appendix.save())
  const merged = await appendAigcPages(Buffer.from(await original.save()), appendixBuffer, 'task-append')
  const mergedInfo = await readPdfInfo(merged.buffer)
  const mergedAigc = parseAigcLabelJson(mergedInfo['AIGC'] ?? '')
  if (mergedInfo['Title'] !== '原简历') fail('append:title', `原简历 Title 被改成了 ${mergedInfo['Title'] ?? '空'}`)
  else pass('append:title')
  if (mergedAigc?.Label !== '1' || mergedAigc.ProduceID !== 'task-append') {
    fail('append:aigc', '追加 AI 解读后没有把 AIGC.Label 置为 1')
  } else pass('append:aigc')
  const draftResume = await new ResumePdfService().render(resume as never, { draft: true })
  const beforeAppend = await readPdfInfo(draftResume.buffer)
  if (beforeAppend['AIGenerated'] !== 'false') {
    fail('append:draft-before', `草稿简历 AIGenerated 应为 false，实际 ${beforeAppend['AIGenerated'] ?? '空'}`)
  } else pass('append:draft-before')
  const draftMerged = await appendAigcPages(draftResume.buffer, appendixBuffer, 'task-append-draft')
  const afterAppend = await readPdfInfo(draftMerged.buffer)
  const afterAigc = parseAigcLabelJson(afterAppend['AIGC'] ?? '')
  if (afterAppend['AIGenerated'] !== 'true' || afterAigc?.Label !== '1' || afterAigc.ProduceID !== 'task-append-draft') {
    fail('append:ai-generated', `追加后 AIGenerated=${afterAppend['AIGenerated'] ?? '空'}，AIGC=${afterAppend['AIGC'] ?? '空'}`)
  } else pass('append:ai-generated')

  console.log(failed === 0 ? '\nAI 标识与提示词安全句：PASS' : `\nAI 标识与提示词安全句：${failed} FAIL`)
  if (failed > 0) process.exit(1)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
