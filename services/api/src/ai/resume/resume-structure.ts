/**
 * 简历文字层的轻量结构识别。
 *
 * 诊断与优化都收到同一份按行保留的提取文本；把这几条确定性规则放在
 * 独立纯函数里，避免两个 LLM 清洗器各自用一套「标题邻域」假设。它只从
 * 原文摘行，不生成公司、时间、学校或描述，因此仍由上层的事实回配守住
 * 「不编造」边界。
 */

export type ResumeStructureBlock = 'experience' | 'project'

export interface ResumeExperienceCandidate {
  /** 原文中的完整一行，供 contentBlocks / modules 回贴和回配。 */
  line: string
  /** 建议落到哪个固定内容块；实习归工作，校园经历归项目。 */
  block: ResumeStructureBlock
  /** 便于测试和提示词说明的来源段落。 */
  section: 'work' | 'internship' | 'project' | 'campus' | 'unlabeled'
}

type ResumeSectionContext = ResumeExperienceCandidate['section'] | 'other'

const SECTION_TITLES: Array<{ pattern: RegExp; section: ResumeSectionContext; block: ResumeStructureBlock }> = [
  { pattern: /^(?:工作|职业)经历$|^工作经验$/, section: 'work', block: 'experience' },
  { pattern: /^(?:实习|兼职)经历$|^实习经验$/, section: 'internship', block: 'experience' },
  { pattern: /^(?:项目|实践)经历$|^项目经验$/, section: 'project', block: 'project' },
  { pattern: /^(?:校园|校内)经历$|^校园实践$/, section: 'campus', block: 'project' },
  { pattern: /^(?:教育|学历)经历$|^教育背景$|^(?:个人|自我)简介$|^(?:个人|自我)评价$|^技能$|^专业技能$|^证书(?:资质)?$/, section: 'other', block: 'experience' },
]

const NON_NAME_TITLES = new Set([
  '简历', '个人简历', '基本信息', '基础信息', '个人信息', '联系方式', '基本资料', '个人资料', '求职意向', '求职方向',
  '工作经历', '工作经验', '实习经历', '实习经验', '项目经历', '项目经验', '校园经历', '校内经历', '校园实践',
  '社会实践', '教育经历', '教育背景', '教育', '工作', '实习', '项目', '经历', '校园', '技能', '专业技能', '证书', '证书资质',
  '获奖情况', '自我评价', '个人简介', '个人总结', '个人概况', '自我介绍', '求职目标',
])

const YEAR = '(?:19|20)\\d{2}'
const DATE_POINT = `${YEAR}\\s*(?:年\\s*(?:\\d{1,2}\\s*月?)?|[./-]\\s*\\d{1,2}?)?`
const DATE_RANGE_RE = new RegExp(
  `${DATE_POINT}\\s*(?:到|至|[-—–~～])\\s*(?:${DATE_POINT}|至今|现在|目前)`,
  'u',
)

/** 统一提取层的换行，保留每行内容，不把左右分栏拆成两个字段。 */
export function resumeTextLines(text: string): string[] {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function titleOf(line: string): (typeof SECTION_TITLES)[number] | undefined {
  const normalized = line.replace(/[\s:：·•|丨]+/g, '')
  if (normalized.length > 12) return undefined
  return SECTION_TITLES.find((item) => item.pattern.test(normalized))
}

function hasOrganizationWord(line: string): boolean {
  return /公司|单位|有限公司|集团|工厂|门店|超市|商贸|医院|学校|银行|酒店|餐饮|中心|机构|事务所|店铺|车间|社区|农场/u.test(line)
}

/**
 * 从简历开头 3 行识别独立姓名（再往下多是城市、岗位等 2~4 字行，容易误认）。姓名候选必须是 2~4 个汉字，且不是固定栏目
 * 标题；带「姓名」前缀的旧写法也继续兼容。无法确定时返回空串，调用方照常
 * 生成其余建议。
 */
export function detectResumeName(text: string, lookahead = 3): string {
  for (const raw of resumeTextLines(text).slice(0, lookahead)) {
    const line = raw.trim()
    const labeled = line.match(/^姓名\s*[：:]?\s*([\u4e00-\u9fff]{2,4})$/u)?.[1]
    if (labeled && !NON_NAME_TITLES.has(labeled)) return labeled
    if (/^[\u4e00-\u9fff]{2,4}$/u.test(line) && !NON_NAME_TITLES.has(line)) return line
  }
  return ''
}

/** 供内容块和 modules 共用的轻量归一，不改变事实字符，只去排版分隔符。 */
export function normalizeResumeStructureText(value: string): string {
  return String(value ?? '').replace(/[\s\u3000,，.。;；:：、·|丨/\\()（）]+/g, '').toLowerCase()
}

/**
 * 识别跨标题、跨分栏的经历条目：
 * - 有时间段且位于工作/实习/项目/校园段落时，按段落归类；
 * - 没有可靠标题时，含组织词的「组织 + 时间段」行仍归工作经历；
 * - 时间表达覆盖「年到年」、点号/月号连字符和「—至今」。
 */
export function extractResumeExperienceCandidates(text: string): ResumeExperienceCandidate[] {
  const candidates: ResumeExperienceCandidate[] = []
  let current: ResumeSectionContext = 'unlabeled'
  let currentBlock: ResumeStructureBlock = 'experience'

  for (const line of resumeTextLines(text)) {
    const heading = titleOf(line)
    if (heading) {
      current = heading.section
      currentBlock = heading.block
      continue
    }
    if (!DATE_RANGE_RE.test(line)) continue

    const inExperienceSection = current === 'work' || current === 'internship' || current === 'project' || current === 'campus'
    const standaloneOrganization = current === 'unlabeled' && hasOrganizationWord(line)
    if (!inExperienceSection && !standaloneOrganization) continue

    const block = current === 'project' || current === 'campus' ? 'project' : currentBlock
    const section = current === 'other' ? 'unlabeled' : current
    const normalized = normalizeResumeStructureText(line)
    if (!candidates.some((item) => normalizeResumeStructureText(item.line) === normalized)) {
      candidates.push({ line, block, section })
    }
  }
  return candidates
}

export const RESUME_STRUCTURE_PROMPT_RULE =
  '结构识别必须逐行看原文：独立一行的2~4个汉字且不是栏目标题可作为姓名；含公司/单位/组织与时间段的行，无论在标题前、哪个内容块或左右分栏，都归入工作/实习经历；时间段包括「2011年到2025年」「2020.09 - 2024.06」「2023年9月—至今」。项目经历、实习经历、校园经历各自的条目也必须进入逐条对照，before 逐字引用原文，不能因为标题缺失而漏掉。'
