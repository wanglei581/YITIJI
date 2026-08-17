// ============================================================
// job-content-screening.ts — 岗位正文歧视性表述**确定性**筛查
//
// 法规依据：《关于规范网络平台招聘类信息发布的通知》（人社部、中央网信办、
// 工信部、公安部、金融监管总局，2026-01）：
//   - 招聘信息「不得含有民族、种族、性别、宗教信仰等歧视性内容」
//   - 「不得在户籍、地域、身份等方面设置限制人力资源流动的条件」
//
// 现状（本文件出现前）：全仓对**导入进来的岗位正文**零检查。
//   - scripts/verify-compliance-copy.mjs 扫的是 apps/{admin,kiosk,partner}/src，
//     即我们自己写的 UI 文案，不看数据库里的岗位内容；
//   - jobs/dto/excel-import.dto.ts 的 isSensitiveColumn 只看**列名**（防简历字段
//     混进来），不看单元格内容；
//   - 而 apps/partner/src/routes/login/LegalDocsModal.tsx 已经让机构书面承诺
//     「不含……歧视性条款」—— 承诺存在，技术侧却没有任何对应的核查。
//
// ── 三条设计约束 ────────────────────────────────────────────────────────────
//
// 1. **只标记，不拒绝。** 本模块没有 assert/throw 版本，这是刻意的。
//    误判会挡掉正常岗位，而岗位下架对求职者的伤害是即时的；
//    确定性关键词的准确率不足以支撑自动拒绝。判定权留给审核员。
//    （对比 common/content-trust.ts：那里有 assertOrgContentTrustActive，
//      因为「来源机构未核验」是确定事实；这里是语言推断，不是。）
//
// 2. **不接模型。** CLAUDE.md 的红线是「AI 是加速器不是前置条件」，
//    且 docs/product/console-ai-upgrade-plan-2026-08.md 已经把「AI 预审分 /
//    疑似歧视表述」规划为 C1（证据等级 E3）。本模块是那个 AI 能力**下面的
//    确定性地板**：模型不可用时它照常工作，模型上线后它仍是可解释的基线。
//    任何一条命中都能指回具体的词和具体的法条，AI 判定做不到这点。
//
// 3. **只派生，不落库。** 与 job-validity.ts 同理，另加一条本模块特有的理由：
//    词表会持续增补，落库的判定结果会**停留在入库那天的词表版本**上，
//    补了词也不会重扫存量。读取时算 = 词表一改，全部存量立即按新词表呈现。
//
// ── 误判控制 ───────────────────────────────────────────────────────────────
//
// 词条一律是**已经具备歧视性的短语**，不是裸词：用「限男性」而不是「男」，
// 否则「男女不限」「不限性别」这类**合规**表述会大面积命中。
// 在此之上再做一层否定前缀检查（不/无/未/非），因为「不限户籍」内部
// 确实含有子串「限户籍」—— 这正是 verify-compliance-copy.mjs 顶部记的那类
// 「命中禁词 ≠ 违规」教训。
//
// **已知误报（接受，不修）**：本身以否定词开头的词条（如「不招外地」）不受
// 否定前缀保护，「我们反对『不招外地』的做法」会误报。真实岗位正文里引用或
// 反驳歧视短语的概率极低；而且本模块只标记不拒绝 —— 一次误报的代价是审核员
// 多看一眼，不是岗位被挡。这个取舍由 verify:job-content-screening 断言 2b 钉住。
//
// **本模块不是合规保证**：它是确定性地板，能抓住的只是写得直白的那部分。
// 隐晦表述（「需适应高强度出差，建议无家庭负担者」）抓不到。
// 因此 contentFlags 为空**不代表**内容合规，人工审核仍是判定方。
// ============================================================

/** 法规点名的两类问题。分类要能直接指回条款，便于审核员判断。 */
export type JobContentFlagCategory = 'discrimination' | 'mobility_restriction'

export interface JobContentFlagRule {
  category: JobContentFlagCategory
  /** 归一化后用于匹配的短语 */
  term: string
  /** 给审核员看的说明：命中了法规的哪一条 */
  label: string
}

export interface JobContentFlag {
  category: JobContentFlagCategory
  term: string
  label: string
  /** 命中位置所在字段，便于审核员直接定位 */
  field: string
}

/**
 * 词表。
 *
 * 只收《通知》明确点名的两类：
 *   歧视性内容 —— 民族、种族、性别、宗教信仰
 *   限制人力资源流动 —— 户籍、地域、身份
 *
 * **刻意不含年龄**：本通知的歧视条款没有点名年龄（年龄歧视另有
 * 《就业促进法》口径）。把它塞进来等于替产品负责人扩大判定范围，
 * 且「限 35 岁以下」在部分法定特殊工种是合规的，误判成本高。
 * 要加的话应当是一次独立的产品决定，连同法条依据一起写进
 * docs/compliance/compliance-boundary.md。
 */
export const JOB_CONTENT_FLAG_RULES: readonly JobContentFlagRule[] = [
  // ── 性别 ──
  { category: 'discrimination', term: '限男性', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '限女性', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '只招男', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '只招女', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '只要男', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '只要女', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '男性优先', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '女性优先', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '仅限男', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  { category: 'discrimination', term: '仅限女', label: '性别歧视（《通知》禁止性别歧视性内容）' },
  // 婚育状况在实务中是性别歧视的常见变体
  { category: 'discrimination', term: '已婚已育优先', label: '婚育状况限制（性别歧视的常见变体）' },
  { category: 'discrimination', term: '限已婚', label: '婚育状况限制（性别歧视的常见变体）' },
  { category: 'discrimination', term: '未婚勿扰', label: '婚育状况限制（性别歧视的常见变体）' },
  { category: 'discrimination', term: '两年内无生育计划', label: '婚育状况限制（性别歧视的常见变体）' },

  // ── 民族 / 种族 / 宗教 ──
  { category: 'discrimination', term: '限汉族', label: '民族歧视（《通知》禁止民族歧视性内容）' },
  { category: 'discrimination', term: '仅限汉族', label: '民族歧视（《通知》禁止民族歧视性内容）' },
  { category: 'discrimination', term: '少数民族勿', label: '民族歧视（《通知》禁止民族歧视性内容）' },
  { category: 'discrimination', term: '限本民族', label: '民族歧视（《通知》禁止民族歧视性内容）' },
  { category: 'discrimination', term: '限信仰', label: '宗教信仰歧视（《通知》禁止宗教信仰歧视性内容）' },
  { category: 'discrimination', term: '教徒勿', label: '宗教信仰歧视（《通知》禁止宗教信仰歧视性内容）' },

  // ── 户籍 / 地域 / 身份（限制人力资源流动）──
  { category: 'mobility_restriction', term: '限本地户籍', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '限本地户口', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '限本市户籍', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '限本市户口', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '需本地户籍', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '需本地户口', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '本地户籍优先', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '本地户口优先', label: '户籍限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '外地勿投', label: '地域限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '外地人勿', label: '地域限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '不要外地', label: '地域限制（《通知》禁止设置限制人力资源流动的条件）' },
  { category: 'mobility_restriction', term: '不招外地', label: '地域限制（《通知》禁止设置限制人力资源流动的条件）' },
]

/** 否定前缀：命中短语前面紧跟这些字时，整句多半是**合规**表述（「不限户籍」）。 */
const NEGATION_PREFIXES = ['不', '无', '未', '非']

/**
 * 归一化：全角→半角、去空白、小写。
 *
 * 与 contract-review-safety-semantics.ts 同口径 —— 不做归一化的话，
 * 「限 本 地 户 籍」「限本地户籍」这类插空格 / 全角变体会整片漏检。
 * 归一化后索引会与原文错位，所以命中只用于**标记**、不回贴原文位置。
 */
export function normalizeForScreening(text: string): string {
  return text
    .normalize('NFKC')
    // U+3000 = 全角空格。写转义而不是字面量：字面量全角空格既会被
    // eslint no-irregular-whitespace 判错，且在 review diff 里肉眼不可辨。
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase()
}

/**
 * 扫描单个字段。返回命中的规则（可能多条）。
 *
 * 纯函数、无 I/O、无模型调用 —— 可被门禁穷举，也可在任何上下文里调用。
 */
export function screenJobText(text: string | null | undefined, field: string): JobContentFlag[] {
  if (!text) return []
  const normalized = normalizeForScreening(text)
  if (!normalized) return []

  const hits: JobContentFlag[] = []
  for (const rule of JOB_CONTENT_FLAG_RULES) {
    const term = normalizeForScreening(rule.term)
    let from = 0
    for (;;) {
      const at = normalized.indexOf(term, from)
      if (at === -1) break
      const preceding = at > 0 ? normalized[at - 1]! : ''
      // 「不限户籍」含子串「限户籍」——否定前缀一律放过，宁可漏报也不误报。
      if (!NEGATION_PREFIXES.includes(preceding)) {
        hits.push({ category: rule.category, term: rule.term, label: rule.label, field })
        break   // 同一规则在同一字段只报一次
      }
      from = at + 1
    }
  }
  return hits
}

/** 参与筛查的岗位字段。只看**内容**字段，不看来源/审核等结构字段。 */
export const SCREENED_JOB_FIELDS = ['title', 'description', 'requirements'] as const

export interface ScreenableJob {
  title?: string | null
  description?: string | null
  requirements?: string | null
}

/**
 * 扫描一条岗位，返回给审核员看的标记清单。
 *
 * **命中不代表违规**，只代表「值得人看一眼」：
 * 一条「本地户口优先」可能是来源平台的原文，需要联系机构改，
 * 也可能出现在「我们不设本地户口优先」这种否定句里（已被否定前缀滤掉一部分，
 * 但语言否定无法穷尽）。所以调用方**只能**把它渲染成待复核提示，
 * 不得据此自动 reject / unpublish —— 由 verify:job-content-screening 断言。
 */
export function screenJob(job: ScreenableJob): JobContentFlag[] {
  return [
    ...screenJobText(job.title, 'title'),
    ...screenJobText(job.description, 'description'),
    ...screenJobText(job.requirements, 'requirements'),
  ]
}
