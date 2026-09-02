import { RESUME_CONTENT_BLOCKS, RESUME_SCORING_DIMENSIONS } from '../interfaces/ai-provider.interface'
import type {
  ResumeContentBlock,
  ResumeContentBlockKey,
  ResumeIssue,
  ResumeIssueEvidence,
  ResumeScoringDimensionKey,
} from '../interfaces/ai-provider.interface'
import { containsForbiddenWord } from '../llm/llm-guard'

// ============================================================
// 简历诊断「内容结构 + 问题证据」清洗器（S25 报告页主视觉的服务端一侧）
//
// 从 llm-resume.service.ts 拆出来的原因（CLAUDE.md §8）：主服务已 390 行，
// 这两类结构的校验逻辑加进去会直接把它推过 500 行阈值。主服务只做编排，
// 清洗规则连同它对应的那几条提示词一起放在本文件，避免「提示词说 6 行、
// 校验按 8 行」这种两地漂移。
//
// 三条设计口径（改动前请先读，它们不是实现细节）：
//
// 1. 证据用**引文拷贝**，不用字符 offset。模型数不准字符数；offset 只在
//    「遮盖后 + 截断后」那份文本里成立，而客户端永远拿不到那份文本，简历原文
//    又从不落库（ai.service.ts 只落派生报告），所以服务端事后也复原不出坐标系。
//    模型只发 {blockKey, quote}，lineIndex 由本文件把 quote 回配到已校验的 lines
//    算出；回配不上就丢弃该证据。悬空下标这一整类错误在设计上不存在。
//
// 2. 严重度**不进契约**。它由 sections[].score/maxScore 机械分档得出，
//    分档规则常驻印在报告页上。能由已有字段算出来的，不问模型。
//
// 3. 防编造校验的基准必须是「**送模型的那份遮盖文本**」，不是简历原文。
//    与 llm-job-fit.service.ts / llm-resume-optimize.service.ts 同一条不变量：
//    evidence 必须能在模型看得到的文本里找到。拿未遮盖原文去校验，等于把
//    「模型只可能抄它看过的东西」放宽成「模型可以说出它没看过的东西」。
//
// 失败纪律：本文件任何一条不合格数据都只影响它自己 —— 丢行、丢证据、丢问题，
// 最坏返回空数组由调用方决定不附带该字段。**绝不**让新字段拖垮整份报告。
// ============================================================

/** 每块最多摆几行原文（27 寸竖屏一屏内可读，且限制回贴体量）。 */
export const MAX_BLOCK_LINES = 6
/** 单行原文最长多少字（超出截断；截断后仍是原文前缀，回配依然成立）。 */
export const MAX_LINE_CHARS = 80
/** 最多几条问题。 */
export const MAX_ISSUES = 8
/** 每条问题最多几处证据。 */
export const MAX_EVIDENCE_PER_ISSUE = 3
/** 问题标题长度上限。 */
const MAX_ISSUE_TITLE_CHARS = 40
/** impact / fixIt 长度上限（与 suggestions 的 MAX_ITEM_CHARS 同档）。 */
const MAX_ISSUE_TEXT_CHARS = 120
/**
 * 回配所需的最小归一化长度。太短的串（"的"、"2023"）在任何简历里都能命中，
 * 匹配上也证明不了「模型真的看过这一行」。与 llm-job-fit 的门槛一致。
 */
const MIN_MATCH_CHARS = 4

const BLOCK_KEYS = new Set<string>(RESUME_CONTENT_BLOCKS.map((b) => b.key))
const DIMENSION_KEYS = new Set<string>(RESUME_SCORING_DIMENSIONS.map((d) => d.key))

/**
 * 归一化后做子串匹配：去空白与常见标点、转小写。
 * 与 llm-resume-optimize.service.ts 的同名函数逐字一致（那条链路是全站最严的
 * 防编造校验）；此处**复用同一口径**，不另立一套宽严标准。
 */
function normalizeForMatch(text: string): string {
  return text.replace(/[\s　,，.。;；:：、·\-—()（）]/g, '').toLowerCase()
}

/** 去控制字符、压空白、trim、截断。空串返回 null。 */
function cleanLine(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const text = [...value]
    .map((ch) => {
      const code = ch.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : ch
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, maxLen) : null
}

/**
 * 内容结构 + 问题证据对应的提示词条款。
 *
 * 放在本文件而不是主服务，是为了让「提示词写的上限」和「校验层强制的上限」
 * 共用同一组常量 —— 它们此前是两地各写一遍数字的典型漂移点。
 * 校验层不信任提示词：下面每条上限在 sanitize* 里都会被二次强制。
 */
export const RESUME_STRUCTURE_PROMPT_RULES: readonly string[] = [
  `contentBlocks：把简历切成固定七块（key 固定、不得自拟）：${RESUME_CONTENT_BLOCKS.map((b) => `${b.key}(${b.label})`).join('、')}。`
    + `每块形如 {"key":"experience","lines":["..."]}；lines 的每一行必须**逐字摘自**上面给出的简历文本，`
    + `不得改写、翻译、合并或补写；每块最多 ${MAX_BLOCK_LINES} 行、每行最多 ${MAX_LINE_CHARS} 字；`
    + `简历里没有的块直接省略该块，不要造一个空块或写「无」。`,
  `issues：最多 ${MAX_ISSUES} 条「问题 + 原文证据」，每条形如 `
    + `{"dim":"quantification","title":"一句话说清是什么问题","evidence":[{"blockKey":"experience","quote":"逐字原文"}],"impact":"...","fixIt":"..."}。`
    + `dim 只能取上面 sections 的 6 个 key 之一，不得新增维度；每条最多 ${MAX_EVIDENCE_PER_ISSUE} 处证据，`
    + `每处 quote 必须逐字出现在简历文本里且属于 blockKey 指定的那一块；给不出原文证据的问题不要写进 issues（可以放进 suggestions）。`,
  'issues[].impact 只描述「读简历的人会看不到什么 / 看不懂什么」，'
    + '不得推断招聘方的决定，不得涉及是否通过筛选、是否获得面试或录用等结果。',
  'issues[].fixIt 只给可执行的改写动作，不得替用户编造经历、数字或成果。',
  '不要输出 issues[].id 或严重度字段：id 由服务端分配，严重度由服务端按维度得分机械分档，写了也会被忽略。',
]

/**
 * 清洗内容结构。
 *
 * @param value      模型返回的 contentBlocks 原始值
 * @param maskedText **送模型的那份遮盖文本**（不是简历原文），防编造校验基准
 *
 * 这里**故意不接** blocked 合规拦截词：lines 是用户自己简历里的句子，被逐字引用
 * 回给他本人看（AI 结果按归属 / 一次性 token 门禁，不外发第三方）。拿禁用词去筛
 * 用户原文，会静默吞掉他真实写过的一行，把「原文逐字」这条不变量变成谎言。
 * 合规约束的是本产品自己的功能与按钮文案 —— 由 title/impact/fixIt 那一侧守住。
 */
export function sanitizeContentBlocks(value: unknown, maskedText: string): ResumeContentBlock[] {
  if (!Array.isArray(value)) return []
  const haystack = normalizeForMatch(maskedText)
  if (!haystack) return []

  const linesByKey = new Map<ResumeContentBlockKey, string[]>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const key = typeof obj['key'] === 'string' ? obj['key'] : ''
    if (!BLOCK_KEYS.has(key)) continue
    const blockKey = key as ResumeContentBlockKey
    if (linesByKey.has(blockKey)) continue // 同一块重复出现，只认第一次
    const rawLines = obj['lines']
    if (!Array.isArray(rawLines)) continue

    const lines: string[] = []
    for (const rawLine of rawLines) {
      // 先截断再回配：normalizeForMatch 是逐字符映射，截断后的归一化串仍是
      // 完整行归一化串的前缀，因此「前缀能匹配」与「整行能匹配」不冲突。
      const line = cleanLine(rawLine, MAX_LINE_CHARS)
      if (!line) continue
      const needle = normalizeForMatch(line)
      if (needle.length < MIN_MATCH_CHARS || !haystack.includes(needle)) continue // 防编造：不在送出去的文本里 → 丢弃
      if (lines.includes(line)) continue
      lines.push(line)
      if (lines.length >= MAX_BLOCK_LINES) break
    }
    if (lines.length > 0) linesByKey.set(blockKey, lines)
  }

  // 按 canonical 顺序与 canonical label 输出，不用模型给的顺序/文案。
  return RESUME_CONTENT_BLOCKS.filter((b) => linesByKey.has(b.key)).map((b) => ({
    key: b.key,
    label: b.label,
    lines: linesByKey.get(b.key)!,
  }))
}

/**
 * 清洗问题与证据。
 *
 * @param value   模型返回的 issues 原始值
 * @param blocks  **已通过校验的** contentBlocks；证据只能落在这里面的行上
 * @param blocked 合规拦截词；title / impact / fixIt 全部过滤，命中即丢弃整条问题
 *
 * blocks 为空时直接返回空数组：没有可指向的原文行，就不存在「问题证据」这件事，
 * 此时的问题与现有 suggestions 没有区别，不必再造一份。
 */
export function sanitizeIssues(
  value: unknown,
  blocks: readonly ResumeContentBlock[],
  blocked: readonly string[],
): ResumeIssue[] {
  if (!Array.isArray(value) || blocks.length === 0) return []

  // 每块的归一化行，用于把 quote 回配成 lineIndex。
  const normalizedByKey = new Map<string, string[]>(
    blocks.map((b) => [b.key, b.lines.map((line) => normalizeForMatch(line))]),
  )
  const linesByKey = new Map<string, string[]>(blocks.map((b) => [b.key, b.lines]))

  const out: ResumeIssue[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>

    const dim = typeof obj['dim'] === 'string' ? obj['dim'] : ''
    if (!DIMENSION_KEYS.has(dim)) continue // 维度漂移的问题条目丢弃，但不新增维度、也不拖垮报告

    const title = cleanLine(obj['title'], MAX_ISSUE_TITLE_CHARS)
    const impact = cleanLine(obj['impact'], MAX_ISSUE_TEXT_CHARS)
    const fixIt = cleanLine(obj['fixIt'], MAX_ISSUE_TEXT_CHARS)
    if (!title || !impact || !fixIt) continue
    // 合规：模型自撰的三段文案必须过拦截词（录用概率 / 匹配度 / 代投推荐类结论）。
    if (containsForbiddenWord(title, blocked)) continue
    if (containsForbiddenWord(impact, blocked)) continue
    if (containsForbiddenWord(fixIt, blocked)) continue

    const evidence = resolveEvidence(obj['evidence'], normalizedByKey, linesByKey)
    if (evidence.length === 0) continue // 一处证据都回配不上 → 这条不是「问题证据」，丢弃

    out.push({
      // id 由服务端分配：它会进 DOM 属性 / React key，模型给的字符串既不保证唯一
      // 也不保证是安全 token；与 label 同一纪律，展示层标识不交给模型。
      id: `I${out.length + 1}`,
      dim: dim as ResumeScoringDimensionKey,
      title,
      evidence,
      impact,
      fixIt,
    })
    if (out.length >= MAX_ISSUES) break
  }
  return out
}

/** 把模型给的 {blockKey, quote} 回配成 {blockKey, lineIndex, quote}；配不上就丢。 */
function resolveEvidence(
  value: unknown,
  normalizedByKey: ReadonlyMap<string, string[]>,
  linesByKey: ReadonlyMap<string, string[]>,
): ResumeIssueEvidence[] {
  if (!Array.isArray(value)) return []
  const out: ResumeIssueEvidence[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const blockKey = typeof obj['blockKey'] === 'string' ? obj['blockKey'] : ''
    const normalizedLines = normalizedByKey.get(blockKey)
    const lines = linesByKey.get(blockKey)
    if (!normalizedLines || !lines) continue

    const quote = cleanLine(obj['quote'], MAX_LINE_CHARS)
    if (!quote) continue
    const needle = normalizeForMatch(quote)
    if (needle.length < MIN_MATCH_CHARS) continue
    // 模型可能只引了整行里的一个片段：按「行包含引文」回配，命中第一行。
    const lineIndex = normalizedLines.findIndex((line) => line.includes(needle))
    if (lineIndex < 0) continue

    const dedupeKey = `${blockKey}#${lineIndex}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({
      blockKey: blockKey as ResumeContentBlockKey,
      lineIndex,
      // quote 取**已校验的那一行**，不取模型原样输出：保证 quote === lines[lineIndex]
      // 这条不变量恒成立，模型无法借 quote 字段夹带任何未经回配的文本。
      quote: lines[lineIndex]!,
    })
    if (out.length >= MAX_EVIDENCE_PER_ISSUE) break
  }
  return out
}
