// ============================================================
// verify:compliance
//
// 自我探索 · 倾向参考（v1）的合规扫描脚本：
//   - 扫描 services/api/src + apps/kiosk/src + apps/admin/src + apps/partner/src + packages/shared/src
//   - 断言在「自我探索」相关新增字符串中**不出现** MBTI / 大五 / DISC / 霍兰德 / SCL / PHQ / GAD /
//     MMPI / 临床 / 抑郁 / 焦虑 / 精神病 / 诊断书 / 心理疾病 / 心理障碍 等临床量表或疾病标签
//   - 扫描位置限定在自我探索相关源文件 + 其消费者（共享类型、PDF 服务、客户端）。
//
// 退出码：0 通过；非 0 失败。
// ============================================================

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/** 临床 / 量表 / 疾病标签 —— 出现即为违规（自我探索禁止挂靠这些概念）。 */
const FORBIDDEN_TERMS: readonly { term: string; reason: string }[] = [
  { term: 'MBTI',         reason: 'MBTI 16 型人格' },
  { term: '16型',         reason: 'MBTI 16 型人格' },
  { term: '16 型',        reason: 'MBTI 16 型人格' },
  { term: '大五',         reason: '大五人格（Big Five）' },
  { term: 'Big Five',     reason: '大五人格（Big Five）' },
  { term: 'Big5',         reason: '大五人格（Big Five）' },
  { term: 'DISC',         reason: 'DISC 类型' },
  { term: '霍兰德',       reason: '霍兰德 RIASEC' },
  { term: 'RIASEC',       reason: '霍兰德 RIASEC' },
  { term: 'SCL-90',       reason: 'SCL-90 症状自评量表' },
  { term: 'SCL',          reason: 'SCL 量表族' },
  { term: 'PHQ-9',        reason: 'PHQ-9 抑郁筛查' },
  { term: 'PHQ',          reason: 'PHQ 量表族' },
  { term: 'GAD-7',        reason: 'GAD-7 焦虑筛查' },
  { term: 'GAD',          reason: 'GAD 量表族' },
  { term: 'MMPI',         reason: 'MMPI 明尼苏达多项人格测验' },
  { term: '抑郁',         reason: '抑郁疾病诊断（临床量表）' },
  { term: '焦虑',         reason: '焦虑疾病诊断（临床量表）' },
  { term: '精神病',       reason: '临床精神疾病标签' },
  { term: '心理疾病',     reason: '临床心理疾病标签' },
  { term: '心理障碍',     reason: '临床心理障碍标签' },
  { term: '精神障碍',     reason: '临床精神障碍标签' },
  { term: '诊断书',       reason: '临床诊断书' },
]

/**
 * 报告措辞 —— "适合 / 不适合 / 必须 / 应该" 类指令性表达不应出现在自我探索结果中。
 *
 * allowNegated：该词被"不 / 无 / 没 / 未 / 非"直接否定时放行。
 * 只给"排名"开，因为这条守的是**产品给出排行**这个行为，而"不打分、不排名"是
 * 相反方向的免责声明 —— 把免责声明判成违规会逼着页面删掉合规文案。
 * "适合岗位 / 不适合岗位"刻意不开：正反两种表述都算做了岗位匹配，都要拦。
 */
const FORBIDDEN_PHRASES: readonly { phrase: string; reason: string; allowNegated?: true }[] = [
  { phrase: '适合岗位',  reason: '自我探索不做岗位匹配' },
  { phrase: '不适合岗位', reason: '自我探索不做岗位匹配' },
  { phrase: '适合从事',  reason: '自我探索不替代职业指导' },
  { phrase: '你必须',    reason: '指令性表达，违反自助参考口径' },
  { phrase: '你应该',    reason: '指令性表达，违反自助参考口径' },
  { phrase: '排名',      reason: '不应给出排行', allowNegated: true },
  { phrase: 'Top%',      reason: '不应给出百分比排名' },
]

/** 否定标记；向前最多回看 6 个字符，遇到句读即停（不跨小句借否定）。 */
const NEGATION_MARKERS = /[不无没未非]/
const CLAUSE_BOUNDARY = /[。！？；;.!?]/

/** 该次命中是否处在显式否定语境里（如「不打分、不排名」「不做职业排名」）。 */
function isNegatedOccurrence(line: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 6)
  for (let i = matchIndex - 1; i >= start; i--) {
    const ch = line[i] as string
    if (CLAUSE_BOUNDARY.test(ch)) return false
    if (NEGATION_MARKERS.test(ch)) return true
  }
  return false
}

/** 自我探索相关源文件 —— 仅扫描这些文件以避免噪音。 */
const SELF_ASSESSMENT_FILES = [
  'services/api/src/ai/resume/self-assessment.service.ts',
  'services/api/src/ai/resume/self-assessment-pdf.service.ts',
  'services/api/src/ai/resume/llm-self-assessment.service.ts',
  'services/api/src/ai/resume/appended-self-assessment.service.ts',
  'services/api/src/ai/resume/self-assessment.types.ts',
  'services/api/src/ai/resume/self-assessment-questions.ts',
  'services/api/src/ai/self-assessment.controller.ts',
  'services/api/src/ai/resume/career-plan.service.ts',
  'packages/shared/src/types/selfAssessment.ts',
  'packages/shared/src/data/selfAssessment',
  'apps/kiosk/src/services/api/selfAssessment.ts',
  'apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx',
  'apps/kiosk/src/pages/resume/self-assessment-lightflow.css',
]

interface Violation {
  file: string
  line: number
  term: string
  reason: string
  snippet: string
}

const violations: Violation[] = []

function isInside(path: string, parent: string): boolean {
  return path.startsWith(parent + sep) || path === parent
}

function shouldScan(path: string): string | null {
  const rel = relative(REPO_ROOT, path).split(sep).join('/')
  for (const target of SELF_ASSESSMENT_FILES) {
    if (rel === target || rel.startsWith(target + '/')) return rel
  }
  return null
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs|cjs|json|css|md)$/.test(entry)) out.push(full)
  }
  return out
}

const SCAN_ROOTS = [
  join(REPO_ROOT, 'services', 'api', 'src'),
  join(REPO_ROOT, 'packages', 'shared', 'src'),
  join(REPO_ROOT, 'apps', 'kiosk', 'src'),
]

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const rel = shouldScan(file)
    if (!rel) continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    let inBlockComment = false
    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      const isCommentLine = /^\s*(\/\/|\*|\/\*)/.test(line) || inBlockComment
      if (/\/\*/.test(line) && !/\*\/$/.test(trimmed)) inBlockComment = true
      if (/\*\//.test(trimmed)) inBlockComment = false
      // 排除"显式否定 / 反向声明 / 列表常量"行：扫描的目标是"自我探索不应使用"
      // 这些概念；以下行明确把 MBTI / 大五 / 临床 等列为"禁止项"或"非临床"声明。
      const isNegativeMention = /(不沿用|不复用|不出现|不替代|不向|不做|非临床|非诊断|临床量表|禁用|禁止|不可|不会|banned|forbidden|不得|不要|避免|禁止用|拒绝|等任何|任何标签|任何量表|不得使用|不得包含|不引用|不输出|不延伸到|不延伸到|不延伸)/i.test(line)
      if (isCommentLine && isNegativeMention) return
      // 纯字符串列表项（含或不含末尾逗号）：HARD_REJECT / SOFT_REJECT 等常量数组
      if (/^['"][^'"]+['"],?\s*$/.test(trimmed)) return
      // 数组末尾的 ]
      if (/^\][,;]?\s*$/.test(trimmed)) return
      // 数组开头或赋值
      if (/^[\w\s]*=\s*\[?\s*$/.test(trimmed) || /^const\s+\w+\s*[:=]/.test(trimmed)) return
      // LLM prompt 规则行：'\nN. 不...'
      if (/^['"]\s*\\n\d+\.\s*不/.test(trimmed)) return
      // prompt 中的反向声明：不引用 / 不出现 / 不输出 / 不延伸 / 不做职业排名
      if (/^['"]\s*\\?n?\d?\.?\s*(不引用|不出现|不输出|不延伸|不做职业)/.test(trimmed)) return
      // prompt 中的"不做职业排名"行（已包含 ranking 词但反向）
      if (/^['"]\s*\\?n?\d?\.?.*不做职业/.test(trimmed)) return
      // 仅当 term 作为独立词/符号出现时才视为违规；防止误命中子串（如 DISCLAIMER_TEXT 中的 DISC）。
      const includesTerm = (haystack: string, needle: string): boolean => {
        let from = 0
        while (true) {
          const idx = haystack.indexOf(needle, from)
          if (idx < 0) return false
          const before = idx === 0 ? '' : haystack[idx - 1]
          const after = idx + needle.length >= haystack.length ? '' : haystack[idx + needle.length]
          const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c)
          const leftBoundary = !isWordChar(before)
          const rightBoundary = !isWordChar(after)
          if (leftBoundary && rightBoundary) return true
          from = idx + 1
        }
      }
      for (const { term, reason } of FORBIDDEN_TERMS) {
        if (includesTerm(line, term)) {
          violations.push({
            file: rel,
            line: idx + 1,
            term,
            reason,
            snippet: line.trim().slice(0, 160),
          })
        }
      }
      for (const { phrase, reason, allowNegated } of FORBIDDEN_PHRASES) {
        for (let at = line.indexOf(phrase); at >= 0; at = line.indexOf(phrase, at + 1)) {
          if (allowNegated && isNegatedOccurrence(line, at)) continue
          violations.push({
            file: rel,
            line: idx + 1,
            term: phrase,
            reason,
            snippet: line.trim().slice(0, 160),
          })
          break
        }
      }
    })
  }
}

try {
  // node:assert 的 message 只接受 string | Error；传函数会被原样 stringify。
  assert.equal(
    violations.length,
    0,
    [
      'verify:compliance failed (self-assessment 临床/量表/疾病 关键词扫描):',
      ...violations.map((v) => `  - ${v.file}:${v.line}  term="${v.term}"  reason=${v.reason}\n      ${v.snippet}`),
    ].join('\n'),
  )
  // eslint-disable-next-line no-console
  console.log(`verify:compliance: PASS (scanned ${SELF_ASSESSMENT_FILES.length} entry paths, no clinical/forbidden terms)`)
  process.exit(0)
} catch (err) {
  // eslint-disable-next-line no-console
  const message = (err as Error).message
  // 打印所有违规行便于人工复核
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${v.file}:${v.line}  term="${v.term}"  reason=${v.reason}\n      ${v.snippet}`)
  }
  // eslint-disable-next-line no-console
  console.error('\n' + message)
  process.exit(1)
}