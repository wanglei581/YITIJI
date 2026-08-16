/**
 * 岗位要求计数 —— 纯确定性聚合规则。
 *
 * **契约源**：packages/shared/src/types/jobRequirementStats.ts
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，packages/shared 是 ESM-only（见 files/file.types.ts 顶部说明）。
 * 任何字段变更必须同时改两处。
 *
 * 本文件的硬约束（由 verify:job-requirement-stats 静态守住）：
 *  - 不 import @nestjs/*、不 import PrismaService、不读 process.env、不调任何 LLM。
 *    这条降级路径存在的理由就是「AI 挂了也能用」，它自己依赖 AI 就自相矛盾。
 *  - 只做计数，不产出排序理由、分数、档位、推荐或投递建议（CLAUDE.md §2）。
 *  - 证据分级恒 E2；本文件不得出现 'E3'。
 */

import {
  CERTIFICATE_DICTIONARY,
  JOB_REQUIREMENT_CERT_DICT_VERSION,
  matchCertificates,
} from './job-requirement-certificates'

// 转出给调用方，证书词典版本仍从 rules 一处读得到
export { JOB_REQUIREMENT_CERT_DICT_VERSION }

// ── 契约类型本地副本（SSOT 见文件头） ────────────────────────────────────────

export type JobRequirementDimensionKey = 'education' | 'experience' | 'skill' | 'certificate'
export type JobRequirementStatSource = 'field' | 'text'
export type JobRequirementSampleIssue = 'no_matching_jobs' | 'no_readable_jobs' | 'below_min_sample'
export type JobRequirementDimensionIssue = 'below_min_stated'

export interface JobRequirementStatItem {
  key: string
  label: string
  count: number
}

export interface JobRequirementDimensionStat {
  dimension: JobRequirementDimensionKey
  label: string
  sources: JobRequirementStatSource[]
  statedCount: number
  sampleSize: number
  sufficient: boolean
  minStatedCount: number
  issue: JobRequirementDimensionIssue | null
  items: JobRequirementStatItem[]
  note: string
}

export interface JobRequirementSampleInfo {
  matchedTotal: number
  countedTotal: number
  titleOnlyTotal: number
  truncated: boolean
  scanLimit: number
  sourceOrgCount: number
  latestSyncTime: string | null
  sufficient: boolean
  minSampleSize: number
  issue: JobRequirementSampleIssue | null
}

export interface JobRequirementStatsFilter {
  keyword: string | null
  city: string | null
  category: string | null
  industry: string | null
  sourceOrgId: string | null
}

export interface JobRequirementStatsData {
  rulesVersion: string
  certificateDictionaryVersion: string
  evidenceLevel: 'E2'
  filter: JobRequirementStatsFilter
  sample: JobRequirementSampleInfo
  dimensions: JobRequirementDimensionStat[]
  boundaryNotes: string[]
}

/** 聚合读得到的岗位字段；服务层只 select 这几列，不取岗位标题 / 链接进结果。 */
export interface JobRequirementSourceRow {
  sourceOrgId: string
  syncTime: Date
  description: string | null
  requirements: string | null
  educationRequirement: string | null
  experienceRequirement: string | null
  skillsJson: string
}

// ── 口径常量 ────────────────────────────────────────────────────────────────

export const JOB_REQUIREMENT_RULES_VERSION = '2026-08-16.1'
export const JOB_REQUIREMENT_MIN_SAMPLE_SIZE = 10
export const JOB_REQUIREMENT_MIN_STATED_COUNT = 5
/** 单次统计最多扫描多少条岗位正文（按同步时间倒序）。超过即 truncated。 */
export const JOB_REQUIREMENT_SCAN_LIMIT = 2000
/** 技能 / 证书维度最多返回多少个取值（按条数降序）。 */
const MAX_OPEN_ITEMS = 20

/** 口径照抄 22-career-plan.html 的纸面页脚，不重新发明措辞。 */
export const JOB_REQUIREMENT_BOUNDARY_NOTES = [
  '条数 = 本机见到的数量，不是市场需求，不是前景排名。',
  '只覆盖本机读过正文的岗位；只有标题、本机读不到内容的一律不参与计数。',
  '本机不预测薪资、不预测录用结果、不承诺任何职业发展结果。',
  '本机不代收简历、不代为投递。是否转方向、是否考证，由你自己决定。',
]

// ── 学历 ────────────────────────────────────────────────────────────────────
// 归类取岗位写明的**最低**学历：「本科及以上，硕士优先」记入本科。
// 实现上取所有命中档位里 rank 最小的那个 —— 误命中更高档位无害，误命中更低档位才有害，
// 所以每个档位的匹配串都必须是该档位独有的写法。

const EDUCATION_LADDER: Array<{ key: string; label: string; rank: number; patterns: string[] }> = [
  { key: 'unlimited',            label: '学历不限',   rank: 0, patterns: ['学历不限', '不限学历'] },
  { key: 'junior_high_or_below', label: '初中及以下', rank: 1, patterns: ['初中', '小学'] },
  { key: 'high_school',          label: '高中',       rank: 2, patterns: ['高中'] },
  { key: 'secondary_vocational', label: '中专/职高/技校', rank: 3, patterns: ['中专', '职高', '技校', '中技'] },
  { key: 'college',              label: '大专',       rank: 4, patterns: ['大专', '专科', '高职'] },
  { key: 'bachelor',             label: '本科',       rank: 5, patterns: ['本科', '学士'] },
  { key: 'master',               label: '硕士',       rank: 6, patterns: ['硕士', '研究生'] },
  { key: 'doctor',               label: '博士',       rank: 7, patterns: ['博士'] },
]

const UNCLASSIFIED_KEY = 'unclassified'
const UNCLASSIFIED_LABEL = '写了但本机没归类'

/**
 * 把正文切成句读片段后再做邻域判定。
 *
 * 不切段的话邻域窗口会跨句取证：真实 seed 里「…本科及以上。\n承担初中数学教学…」
 * 的「初中」窗口正好够到上一句句尾的「以上」，于是这条本科岗被判成「初中及以下」。
 * 逗号也切：同一句里「面向初中生，本科及以上」同样会串味。
 * 切细的代价是漏算（少一条），不是误算（多一条）—— 这个方向是安全的。
 */
const SEGMENT_SPLIT = /[。！？；;，,\n\r]+/
function splitSegments(text: string): string[] {
  return text.split(SEGMENT_SPLIT).map((s) => s.trim()).filter(Boolean)
}

/** 「博士研究生」「硕士研究生」先折叠，避免 研究生 把博士拉低到硕士档。 */
function normalizeEducationText(raw: string): string {
  return raw
    .replace(/博士研究生/g, '博士')
    .replace(/硕士研究生/g, '硕士')
    .replace(/中等专业学校|中等专科/g, '中专')
}

/**
 * 结构化学历字段的取值归类。字段本身就是「学历要求」，出现的档位即要求，不需要旁证。
 * 命中多个档位时取 rank 最小者（最低要求）。
 */
function classifyEducationValue(raw: string): { key: string; label: string } | null {
  const text = normalizeEducationText(raw)
  if (text.trim() === '不限') return { key: 'unlimited', label: '学历不限' }
  let best = Number.POSITIVE_INFINITY
  for (const level of EDUCATION_LADDER) {
    if (level.patterns.some((p) => text.includes(p)) && level.rank < best) best = level.rank
  }
  const level = EDUCATION_LADDER.find((l) => l.rank === best)
  return level ? { key: level.key, label: level.label } : null
}

/** 学历档位要算「要求」，附近必须有这些字样之一。 */
const EDUCATION_QUALIFIER = /及以上|以上|学历|毕业|起/
const EDUCATION_QUALIFIER_WINDOW = 6

/**
 * 岗位正文里的学历要求。
 *
 * 为什么不能直接沿用字段那套「出现即命中」：真实 seed 里有一条岗位，任职要求写的是
 * 「数学相关专业本科及以上」，岗位描述写的是「承担**初中**数学教学」——
 * 直接匹配会把这条本科岗按最低档记成「初中及以下」。档位取最低这条规则对
 * **向上**误命中无害、对**向下**误命中致命，所以正文路径必须要求旁证：
 * 档位词前后一小段里得有「及以上 / 以上 / 学历 / 毕业 / 起」。
 * 代价是「要求本科」这种没有量词的写法会被漏掉 —— 少数比多数安全。
 */
function classifyEducationText(raw: string): { key: string; label: string } | null {
  let best = Number.POSITIVE_INFINITY
  for (const segment of splitSegments(normalizeEducationText(raw))) {
    for (const level of EDUCATION_LADDER) {
      if (level.rank >= best) continue
      if (level.patterns.some((p) => isQualifiedEducationHit(segment, p))) best = level.rank
    }
  }
  const level = EDUCATION_LADDER.find((l) => l.rank === best)
  return level ? { key: level.key, label: level.label } : null
}

/** 片段内某个档位词是否带着「及以上 / 学历 / 毕业」这类旁证出现。 */
function isQualifiedEducationHit(segment: string, pattern: string): boolean {
  let from = 0
  for (;;) {
    const idx = segment.indexOf(pattern, from)
    if (idx < 0) return false
    from = idx + pattern.length
    const context = segment.slice(
      Math.max(0, idx - EDUCATION_QUALIFIER_WINDOW),
      idx + pattern.length + EDUCATION_QUALIFIER_WINDOW,
    )
    if (EDUCATION_QUALIFIER.test(context)) return true
  }
}

// ── 经验 ────────────────────────────────────────────────────────────────────

const EXPERIENCE_BUCKETS: Array<{ key: string; label: string; rank: number }> = [
  { key: 'unlimited', label: '经验不限',  rank: 0 },
  { key: 'fresh',     label: '应届/无经验要求', rank: 1 },
  { key: 'under_1',   label: '1 年以下',  rank: 2 },
  { key: 'y1_3',      label: '1–3 年',    rank: 3 },
  { key: 'y3_5',      label: '3–5 年',    rank: 4 },
  { key: 'y5_10',     label: '5–10 年',   rank: 5 },
  { key: 'over_10',   label: '10 年以上', rank: 6 },
]

function bucketByYears(years: number): { key: string; label: string; rank: number } {
  const key = years < 1 ? 'under_1' : years < 3 ? 'y1_3' : years < 5 ? 'y3_5' : years < 10 ? 'y5_10' : 'over_10'
  return EXPERIENCE_BUCKETS.find((b) => b.key === key)!
}

const EXPERIENCE_ANCHORS = ['经验', '工作经历', '从业']
/** 锚点前后各取多少字符作为判定窗口 —— 防止把「2026 届」「3 年制」当成经验年限。 */
const EXPERIENCE_WINDOW = 14

/**
 * 在「经验 / 工作经历 / 从业」的邻域窗口里找年限，取全文最低要求。
 * 窗口外的年份数字一律不参与。
 */
function classifyExperience(raw: string): { key: string; label: string } | null {
  let bestRank = Number.POSITIVE_INFINITY
  // 与学历同理：先切句读，窗口不得跨句取证
  for (const segment of splitSegments(raw)) {
    for (const anchor of EXPERIENCE_ANCHORS) {
      let from = 0
      for (;;) {
        const idx = segment.indexOf(anchor, from)
        if (idx < 0) break
        from = idx + anchor.length
        const window = segment.slice(Math.max(0, idx - EXPERIENCE_WINDOW), idx + anchor.length + EXPERIENCE_WINDOW)
        const hit = classifyExperiencePhrase(window)
        if (hit && hit.rank < bestRank) bestRank = hit.rank
      }
    }
  }
  const bucket = EXPERIENCE_BUCKETS.find((b) => b.rank === bestRank)
  return bucket ? { key: bucket.key, label: bucket.label } : null
}

/** 一段短文字里的经验要求；命中多条时由调用方按 rank 取最低。 */
function classifyExperiencePhrase(text: string): { key: string; label: string; rank: number } | null {
  if (/不限/.test(text)) return EXPERIENCE_BUCKETS[0]!
  if (/应届|在校|在读|无经验|无工作经验/.test(text)) return EXPERIENCE_BUCKETS[1]!
  const range = text.match(/(\d+)\s*[-~～至到]\s*\d+\s*年/)
  if (range) return bucketByYears(Number(range[1]))
  const above = text.match(/(\d+)\s*年(?:及)?以上/)
  if (above) return bucketByYears(Number(above[1]))
  const plain = text.match(/(\d+)\s*年/)
  if (plain) return bucketByYears(Number(plain[1]))
  return null
}


// ── 技能 ────────────────────────────────────────────────────────────────────

function parseSkills(skillsJson: string): string[] {
  let parsed: unknown
  try { parsed = JSON.parse(skillsJson) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0 && s.length <= 40)
}

// ── 计数容器 ────────────────────────────────────────────────────────────────

class Counter {
  private readonly counts = new Map<string, number>()
  private readonly labels = new Map<string, string>()
  /** 明确写了本维度的岗位条数（不是命中条数之和 —— 一个岗位可以命中多个取值）。 */
  stated = 0
  readonly sources = new Set<JobRequirementStatSource>()

  add(key: string, label: string): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
    if (!this.labels.has(key)) this.labels.set(key, label)
  }

  items(limit: number): JobRequirementStatItem[] {
    return [...this.counts.entries()]
      .map(([key, count]) => ({ key, label: this.labels.get(key) ?? key, count }))
      .sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, limit)
  }
}

function toDimension(
  dimension: JobRequirementDimensionKey,
  label: string,
  note: string,
  counter: Counter,
  sampleSize: number,
  limit: number,
  sampleSufficient: boolean,
): JobRequirementDimensionStat {
  const sufficient = sampleSufficient && counter.stated >= JOB_REQUIREMENT_MIN_STATED_COUNT
  return {
    dimension,
    label,
    sources: (['field', 'text'] as const).filter((s) => counter.sources.has(s)),
    statedCount: counter.stated,
    sampleSize,
    sufficient,
    minStatedCount: JOB_REQUIREMENT_MIN_STATED_COUNT,
    issue: sufficient ? null : 'below_min_stated',
    // 样本不足时恒空：给一个「3 条里 2 条要电工证」式的数字，比不给更害人。
    items: sufficient ? counter.items(limit) : [],
    note,
  }
}

const NOTES = {
  education: '按岗位写明的**最低**学历归类：「本科及以上，硕士优先」记入本科。优先取来源平台的学历字段；字段为空时在岗位正文里匹配，且档位词附近必须有「及以上 / 以上 / 学历 / 毕业」等字样才算要求 —— 「承担初中数学教学」这类岗位内容不会被当成学历要求。写法不含这些字样的（如只写「要求本科」）会被漏掉，宁可少算不多算。',
  experience: '只在「经验 / 工作经历 / 从业」附近的文字里取年限，避免把「2026 届」「3 年制」当成经验要求。同一岗位写了多个年限时取最低的那个。',
  skill: '来源平台提供的技能标签**原样计数**，本机不做同义词合并 ——「UG」与「UG/NX」会分别计数。岗位正文里的技能描述不参与本维度。',
  certificate: '按证书关键词在岗位正文中的命中条数统计，同一岗位同一证书只计一次。关键词**之前**出现「无需 / 不要求」等否定词时不计；写在关键词之后的否定表述本机不做语义区分，仍会计入。**本机词典没收录的证书不会出现在这张表里，不代表岗位没有要求。**',
} as const

// ── 聚合入口 ────────────────────────────────────────────────────────────────

export interface AggregateInput {
  filter: JobRequirementStatsFilter
  /** 命中筛选的真实总条数（含只有标题的），来自 count 查询，不受扫描上限影响。 */
  matchedTotal: number
  /** 按同步时间倒序取到的岗位行，最多 JOB_REQUIREMENT_SCAN_LIMIT 条。 */
  rows: JobRequirementSourceRow[]
}

export function aggregateJobRequirementStats(input: AggregateInput): JobRequirementStatsData {
  const { filter, matchedTotal, rows } = input

  const education = new Counter()
  const experience = new Counter()
  const skill = new Counter()
  const certificate = new Counter()

  let countedTotal = 0
  let titleOnlyTotal = 0
  const sourceOrgs = new Set<string>()
  let latestSync: Date | null = null

  for (const row of rows) {
    const requirements = (row.requirements ?? '').trim()
    const description = (row.description ?? '').trim()
    const body = `${requirements}\n${description}`.trim()
    // 「本机读过正文」的定义：任职要求或岗位描述至少有一段非空。只有标题的一律不计入。
    if (!body) { titleOnlyTotal += 1; continue }

    countedTotal += 1
    sourceOrgs.add(row.sourceOrgId)
    if (!latestSync || row.syncTime.getTime() > latestSync.getTime()) latestSync = row.syncTime

    // 学历：结构化字段优先，字段为空才读正文
    const eduField = (row.educationRequirement ?? '').trim()
    if (eduField) {
      education.stated += 1
      education.sources.add('field')
      const hit = classifyEducationValue(eduField)
      education.add(hit?.key ?? UNCLASSIFIED_KEY, hit?.label ?? UNCLASSIFIED_LABEL)
    } else {
      const hit = classifyEducationText(body)
      if (hit) { education.stated += 1; education.sources.add('text'); education.add(hit.key, hit.label) }
    }

    // 经验：同上
    const expField = (row.experienceRequirement ?? '').trim()
    if (expField) {
      experience.stated += 1
      experience.sources.add('field')
      // 结构化字段常见裸值（'不限' / '3-5年'）没有「经验」二字，走不到锚点窗口 ——
      // 锚点匹配落空时直接把整段字段当短语判一次，避免全部落进「未归类」。
      const hit = classifyExperience(expField) ?? classifyExperiencePhrase(expField)
      experience.add(hit?.key ?? UNCLASSIFIED_KEY, hit?.label ?? UNCLASSIFIED_LABEL)
    } else {
      const hit = classifyExperience(body)
      if (hit) { experience.stated += 1; experience.sources.add('text'); experience.add(hit.key, hit.label) }
    }

    // 技能：只认结构化标签，不在正文里挖
    const skills = parseSkills(row.skillsJson)
    if (skills.length > 0) {
      skill.stated += 1
      skill.sources.add('field')
      const seen = new Set<string>()
      for (const s of skills) {
        const key = s.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        skill.add(key, s)
      }
    }

    // 证书：词典命中（正文 + 技能标签一起进 haystack）
    const certHits = matchCertificates(`${body}\n${skills.join('\n')}`.toLowerCase())
    if (certHits.size > 0) {
      certificate.stated += 1
      certificate.sources.add('text')
      for (const key of certHits) {
        const entry = CERTIFICATE_DICTIONARY.find((c) => c.key === key)!
        certificate.add(entry.key, entry.label)
      }
    }
  }

  const sampleIssue: JobRequirementSampleIssue | null =
    matchedTotal === 0 ? 'no_matching_jobs'
      : countedTotal === 0 ? 'no_readable_jobs'
        : countedTotal < JOB_REQUIREMENT_MIN_SAMPLE_SIZE ? 'below_min_sample'
          : null
  const sampleSufficient = sampleIssue === null

  return {
    rulesVersion: JOB_REQUIREMENT_RULES_VERSION,
    certificateDictionaryVersion: JOB_REQUIREMENT_CERT_DICT_VERSION,
    evidenceLevel: 'E2',
    filter,
    sample: {
      matchedTotal,
      countedTotal,
      titleOnlyTotal,
      truncated: matchedTotal > rows.length,
      scanLimit: JOB_REQUIREMENT_SCAN_LIMIT,
      sourceOrgCount: sourceOrgs.size,
      latestSyncTime: latestSync ? latestSync.toISOString() : null,
      sufficient: sampleSufficient,
      minSampleSize: JOB_REQUIREMENT_MIN_SAMPLE_SIZE,
      issue: sampleIssue,
    },
    dimensions: [
      toDimension('education', '学历要求', NOTES.education, education, countedTotal, EDUCATION_LADDER.length + 1, sampleSufficient),
      toDimension('experience', '经验要求', NOTES.experience, experience, countedTotal, EXPERIENCE_BUCKETS.length + 1, sampleSufficient),
      toDimension('skill', '技能标签', NOTES.skill, skill, countedTotal, MAX_OPEN_ITEMS, sampleSufficient),
      toDimension('certificate', '证书要求', NOTES.certificate, certificate, countedTotal, MAX_OPEN_ITEMS, sampleSufficient),
    ],
    boundaryNotes: [...JOB_REQUIREMENT_BOUNDARY_NOTES],
  }
}
