// ============================================================
// PII 遮盖引擎（S0-2 前身：contract-review/contract-review-pii-masker.ts）
//
// 2026-08-16 S0-2 把本文件从 contract-review/ 提到 common/pii/，
// 让简历链（A 组）与定向输出链（B 组）也能在喂模型前复用同一套遮盖实现。
// contract-review/contract-review-pii-masker.ts 保留为 re-export 薄壳，
// 合同审查侧的调用点与行为**逐字不变**。
//
// 唯一的实现改动：maskContractPages 增加可选的 assertComplete 开关（默认 true）。
// 关掉它只跳过末尾的完整性断言，遮盖过程本身完全一致 —— 简历链需要拿到
// 「已遮盖但断言未通过」的文本（原因见 common/pii/llm-input-mask.ts 的说明）。
// 合同审查侧不传该参数，因此仍然是 fail-closed 的严格模式。
// ============================================================

const MAX_PAGES = 50
const MAX_INPUT_CODE_UNITS = 2_000_000
const MAX_OUTPUT_CODE_UNITS = 500_000
const MAX_UNIQUE_ENTITIES = 256
const MAX_ENTITY_SEARCH_WORK = 10_000_000

export interface ContractMaskPage {
  readonly pageNumber: number
  readonly text: string
}

export interface ContractPartyFacts {
  readonly hasPartyA: boolean
  readonly hasPartyB: boolean
  readonly hasEmployer: boolean
  readonly hasWorker: boolean
  readonly hasUscc: boolean
  readonly hasBankAccount: boolean
}

export interface ContractMaskResult {
  readonly pages: readonly ContractMaskPage[]
  readonly partyFacts: ContractPartyFacts
  /**
   * 占位符 → 被它替换掉的原文串（首次出现的那一份）。
   *
   * **只有显式传 collectRestoreMap: true 时才存在**，默认不返回。
   * 合同审查链路刻意不取它 —— contract-review-pii-masker.test.ts 断言
   * 遮盖结果的键集恒为 ['pages','partyFacts'] 且序列化后不含原文，
   * 那条断言的用意就是「遮盖产物不得夹带 PII」，不能为了本功能放宽。
   *
   * ⚠️ 合规红线：本 Map 的 value 就是**未脱敏的 PII 原文**。
   *   - 禁止落日志、禁止落库、禁止随响应出接口、禁止送模型；
   *   - 只允许在同一次请求的内存里，用于把模型回包中的占位符还原成原值
   *     （见 common/pii/llm-input-mask.ts 的 maskUserTextForLlmReversible）。
   *
   * 为什么需要它：简历优化 / 排版调整的产物是**用户要打印的那份简历**，
   * 里面的姓名 / 手机 / 邮箱必须是真值。只遮盖不还原，等于把
   * `[手机号_1]` 印到用户简历上 —— 那是拿功能损坏换合规，不可接受。
   * 占位符按 `[类别_序号]` 全局去重编号，因此还原是无歧义的 1:1 映射。
   */
  readonly restoreMap?: ReadonlyMap<string, string>
}

type MaskCategory = '劳动者' | '用人单位' | '身份证' | '手机号' | '银行卡' | '邮箱' | '详细地址' | '统一社会信用代码'

type Candidate = Readonly<{
  start: number; end: number; category: MaskCategory; key: string; priority: number
}>
type KnownEntity = Readonly<{ category: '劳动者' | '用人单位'; key: string }>
type MappedText = Readonly<{ text: string; starts?: Uint32Array; ends?: Uint32Array }>

const ID_18 = /(?<![0-9A-Za-z])(?:\d[\s-]?){6}(?:18|19|20)\d{2}[\s-]?(?:0[1-9]|1[0-2])[\s-]?(?:0[1-9]|[12]\d|3[01])[\s-]?(?:\d[\s-]?){3}[0-9Xx](?![0-9A-Za-z])/gu
const ID_15 = /(?<!\d)(?:\d[\s-]?){6}(?:\d[\s-]?){2}(?:0[1-9]|1[0-2])[\s-]?(?:0[1-9]|[12]\d|3[01])[\s-]?(?:\d[\s-]?){2}\d(?!\d)/gu
const PHONE = /(?<!\d)(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}(?!\d)/gu
const BANK_CARD = /(?<!\d)(?:\d[\s-]?){15,18}\d(?!\d)/gu
const EMAIL = /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,63}/giu
const USCC = /(?<![0-9A-Z])(?=[0-9A-HJ-NPQRTUWXY]{18}(?![0-9A-Z]))(?=[0-9A-HJ-NPQRTUWXY]*[A-HJ-NPQRTUWXY])[0-9A-HJ-NPQRTUWXY]{18}/gu
const NEXT_FIELD_LABEL = '(?:姓名|乙方|劳动者|甲方|用人单位(?:名称)?|通讯地址|联系地址|住所|住址|地址|身份证号?|证件号码?|手机号?|联系电话|传真(?:号码?)?|电子邮箱|邮箱地址|银行卡号?|银行账户|银行账号|账户号?|账号|统一社会信用代码)\\s*[:：]'
const LOOSE_FIELD_LABEL = '(?:身份证号?|证件号码?|身份证|证件|手机号?|联系电话|电话|联系号码|传真(?:号码?)?|电子邮箱|邮箱地址|邮箱|银行卡号?|银行账户|银行账号|账户号?|账号)'
const CHINESE_NUMBER = '[零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬]+'
const ARABIC_NUMBER = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)'
const NUMBER_VALUE = `(?:${ARABIC_NUMBER}|${CHINESE_NUMBER})`
const SCALED_NUMBER_VALUE = `${NUMBER_VALUE}(?:万|千)?`
const RANGE_CONNECTOR = '(?:-|－|—|至|到)'
const SALARY_VALUE = `${SCALED_NUMBER_VALUE}(?:\\s*元\\s*${RANGE_CONNECTOR}\\s*${SCALED_NUMBER_VALUE}|\\s*${RANGE_CONNECTOR}\\s*${SCALED_NUMBER_VALUE})?\\s*元`
const TERM_UNIT = '(?:个月|年|月|日)'
const TERM_VALUE = `${NUMBER_VALUE}(?:\\s*${TERM_UNIT}\\s*${RANGE_CONNECTOR}\\s*${NUMBER_VALUE}|\\s*${RANGE_CONNECTOR}\\s*${NUMBER_VALUE})?\\s*${TERM_UNIT}`
const LEGAL_RIGHT_BOUNDARY = '(?=[\\s，,;；。\\n]|$)'
const SALARY_FACT_CORE = `(?:每月\\s*)?(?:月薪|基本工资|工资|薪资|劳动报酬)\\s*(?:为|[:：])?\\s*(?:人民币)?\\s*${SALARY_VALUE}(?:[/／]月|每月)?`
const TERM_FACT_CORE = `(?:合同期限|合同期|期限|试用期|同期)\\s*(?:为|[:：])?\\s*${TERM_VALUE}`
const CHINESE_DATE = '\\d{4}年(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12]\\d|3[01])日'
const ISO_DATE = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])'
const SLASH_DATE = '\\d{4}/(?:0[1-9]|1[0-2])/(?:0[1-9]|[12]\\d|3[01])'
const DATE_VALUE = `(?:${CHINESE_DATE}|${ISO_DATE}|${SLASH_DATE})`
const DOB_DATE = '(?:(?:19|20)\\d{2}\\s{0,4}(?:[-—/.]\\s{0,4}(?:0[1-9]|1[0-2])\\s{0,4}[-—/.]\\s{0,4}(?:0[1-9]|[12]\\d|3[01])|年\\s{0,4}(?:0?[1-9]|1[0-2])\\s{0,4}月\\s{0,4}(?:0?[1-9]|[12]\\d|3[01])\\s{0,4}日))'
const DOB_JOIN = '(?:\\s{0,8}|\\s{0,4}[-—/.,，、]\\s{0,4})'
const DOB_ID = new RegExp(`(?<![0-9A-Za-z])\\d{6}${DOB_JOIN}${DOB_DATE}${DOB_JOIN}\\d{3}[0-9Xx](?![0-9A-Za-z])`, 'gu')
const DATE_TOKEN = new RegExp(`(?<!\\d)${DATE_VALUE}(?!\\d)`, 'gu')
const PII_SEPARATOR_CHAR = /[\s,，.;；:：、/／\\~～—－-]/u
const DATE_FACT_CORE = `(?:自\\s*)?${DATE_VALUE}(?:\\s*(?:至|到|-|－|—|~|～)\\s*${DATE_VALUE})?(?:\\s*(?:起履行|起生效|生效|起))?`
const ARTICLE_NUMBER = '[一二三四五六七八九十百零\\d]+'
const BASIS_FACT_CORE = `(?:(?:依据|根据)\\s*(?:(?:《劳动合同法》|劳动合同法)(?:\\s*第${ARTICLE_NUMBER}条)?|第${ARTICLE_NUMBER}条)|第${ARTICLE_NUMBER}条)`
const STANDARD_SAFE_FACT_PREFIX = `(?:${SALARY_FACT_CORE}|${TERM_FACT_CORE}|${DATE_FACT_CORE}|${BASIS_FACT_CORE})${LEGAL_RIGHT_BOUNDARY}`
const WORKPLACE_FACT_CORE = '工作地点\\s*(?:为|[:：])\\s*[㐀-鿿A-Za-z0-9（）()· \\t-]{1,80}?'
const WORKPLACE_FACT_PREFIX = `${WORKPLACE_FACT_CORE}(?=(?:[，,;；。\\n]|$|\\s*${NEXT_FIELD_LABEL}|[ \\t]+${STANDARD_SAFE_FACT_PREFIX}))`
const SAFE_LEGAL_FACT_PREFIX = `(?:${STANDARD_SAFE_FACT_PREFIX}|${WORKPLACE_FACT_PREFIX})`
const SAFE_BOILERPLATE_PREFIX = `(?:以下简称(?:甲方|乙方))${LEGAL_RIGHT_BOUNDARY}`
const SAFE_LEGAL_FACT_AT = new RegExp(SAFE_LEGAL_FACT_PREFIX, 'uy')
const SAFE_BOILERPLATE_AT = new RegExp(SAFE_BOILERPLATE_PREFIX, 'uy')
const NEXT_FIELD_AT = new RegExp(NEXT_FIELD_LABEL, 'uy')
const CONDITIONAL_SEPARATOR_BOUNDARY = `[，,;；]\\s*(?=(?:$|${NEXT_FIELD_LABEL}|${LOOSE_FIELD_LABEL}|${SAFE_LEGAL_FACT_PREFIX}|${SAFE_BOILERPLATE_PREFIX}))`
const FIELD_BOUNDARY_BODY = `(?:[。\\n]|$|\\s*${NEXT_FIELD_LABEL}|[ \\t]+${SAFE_LEGAL_FACT_PREFIX}|${CONDITIONAL_SEPARATOR_BOUNDARY})`
const FIELD_BOUNDARY = `(?=${FIELD_BOUNDARY_BODY})`
const WORKER_BOUNDARY = `(?=(?:${SAFE_LEGAL_FACT_PREFIX}|${FIELD_BOUNDARY_BODY}|[ \\t]+(?:身份证|证件|手机|电话|联系号码|传真|邮箱|银行卡|账户|账号)))`
const LABELED_WORKER = new RegExp(
  `(?:乙方|劳动者|姓名)\\s*[:：]\\s*([㐀-鿿·]{2,20}?|[A-Za-z][A-Za-z .'-]{1,60}?)${WORKER_BOUNDARY}`,
  'gu',
)
const LABELED_EMPLOYER = new RegExp(
  `(?:甲方|用人单位)(?:名称)?\\s*[:：]\\s*(.{2,100}?)${FIELD_BOUNDARY}`,
  'gu',
)
// `(?<!邮箱)`：`邮箱地址：a@example.com` 里的 `地址` 不是住址标签。
// 没有这个否定后顾时，邮箱值会被当成「详细地址」遮成 [详细地址_N]，
// 而检测侧按 `邮箱地址` 期待的是 [邮箱_N] —— 类别对不上即判残留，
// 于是任何写了「邮箱地址：」的合同都必定抛 CONTRACT_PII_MASK_INCOMPLETE。
// 这是与座机/传真同一类的检测–遮盖不对称，且在 main 上同样复现。
const ADDRESS_LABEL = '(?<!邮箱)(?:通讯地址|联系地址|住所|住址|地址)'
const LABELED_ADDRESS = new RegExp(
  `${ADDRESS_LABEL}\\s*[:：]\\s*(.{3,120}?)${FIELD_BOUNDARY}`,
  'gu',
)
const LABELED_ID = /(?:身份证|证件)\s*[:：]?\s*([0-9Xx][0-9Xx\s-]{14,40})/gu
const LABELED_BANK = /(?:银行卡|银行账户|银行账号|账户|账号)\s*[:：]\s*([0-9][0-9\s,，.;；、/／\\~～—－年月日至到-]{15,60})/gu
const LABELED_USCC = /(?:统一社会信用代码)\s*[:：]\s*([0-9A-Z]{18})/gu
const BANK_LABEL = /(?:银行卡|银行账户|银行账号|账户|账号)\s*[:：]/gu
const USCC_LABEL = /统一社会信用代码\s*[:：]/gu
const SENSITIVE_LABEL = new RegExp(
  `(姓名|乙方|劳动者|甲方|用人单位(?:名称)?|${ADDRESS_LABEL})\\s*[:：]\\s*`,
  'gu',
)

// ============================================================
// 松散标签表 —— 检测侧与遮盖侧的**唯一来源**
//
// 2026-08-17 生产故障（analyze 阶段 100% 失败、错误码
// CONTRACT_REVIEW_ANALYSIS_FAILED）的直接成因就是这张表在修复前不存在：
// 检测侧（LOOSE_VALUE_LABEL + looseLabelCategory）自己维护一串标签，
// 遮盖侧（LABELED_* 与整值正则）另外维护一串，两边逐渐漂移到
//
//   「`联系电话` 这个标签检测得到，`021-62345678` 这个座机号遮盖不掉」
//
// 于是 assertNoHighConfidencePii 判定「检测到标签、却没看到对应占位符」
// ⇒ 抛 CONTRACT_PII_MASK_INCOMPLETE。该异常是**裸 Error**，在 orchestrator 的
// safeStageError 里被折叠成兜底码，线上只看得到笼统的 ANALYSIS_FAILED。
// 遮盖只在 analyze() 跑、extract() 不跑，这正是 extract 成功而 analyze 必死的原因。
//
// 现在两侧都从本表派生：
//   - 检测：LOOSE_VALUE_LABEL（标签正则）+ LOOSE_LABEL_CATEGORY（标签 → 类别）
//   - 遮盖：LABELED_PHONE / LABELED_SHORT_ACCOUNT（按类别筛出标签再拼正则）
// 标签集合再也不可能只改一侧。
//
// 第三列 `detect`：该标签是否参与**检测**。
//   true  —— 检测 + 遮盖。这一组必须与修复前的 LOOSE_VALUE_LABEL 逐字相同，
//            扩大检测面 = 扩大 fail-closed 面 = 制造新的线上失败，不做。
//   false —— **只遮盖、不检测**。`传真` / `联系号码` 属于此类：它们本来就不在
//            LOOSE_VALUE_LABEL 里（`传真：021-12345678` 既不被遮也不被判残留），
//            所以它们不是本次故障的触发源。但传真号是实打实的 PII 且当前
//            原样送进模型，属于**泄漏**而非误杀 —— 补遮盖是纯粹的安全收益，
//            补检测则会凭空新增失败路径（例如 `传真：N/A` 会开始判残留）。
//
// 由此得到本表要维持的不变量：**检测标签 ⊆ 遮盖标签**。
// 遮盖侧可以更宽（更安全），检测侧永远不许比遮盖侧宽（这正是故障成因）。
//
// ⚠️ 顺序即正则备选顺序：**长标签必须排在与它同前缀的短标签之前**
//    （身份证号 → 身份证、银行卡号 → 银行卡、手机号 → 手机、联系电话 → 电话、
//      传真号码 → 传真号 → 传真）。过滤保序，因此两侧派生出的正则都正确。
// ============================================================
const LOOSE_LABEL_RULES = Object.freeze([
  ['身份证号', '身份证', true],
  ['证件号码', '身份证', true],
  ['手机号', '手机号', true],
  ['联系电话', '手机号', true],
  ['联系号码', '手机号', false],
  ['传真号码', '手机号', false],
  ['传真号', '手机号', false],
  ['传真', '手机号', false],
  ['银行卡号', '银行卡', true],
  ['银行账号', '银行卡', true],
  ['账户号', '银行卡', true],
  ['电子邮箱', '邮箱', true],
  ['邮箱地址', '邮箱', true],
  ['统一社会信用代码', '统一社会信用代码', true],
  ['银行卡', '银行卡', true],
  ['银行账户', '银行卡', true],
  ['账号', '银行卡', true],
  ['账户', '银行卡', true],
  ['身份证', '身份证', true],
  ['证件', '身份证', true],
  ['手机', '手机号', true],
  ['电话', '手机号', true],
  ['邮箱', '邮箱', true],
] as const satisfies ReadonlyArray<readonly [string, MaskCategory, boolean]>)

/** 标签 → 占位符类别。**只含检测标签**，检测侧据此判断该出现哪一类占位符。 */
const LOOSE_LABEL_CATEGORY: ReadonlyMap<string, MaskCategory> = new Map(
  LOOSE_LABEL_RULES.filter(([, , detect]) => detect).map(([label, category]) => [label, category]),
)

/** 遮盖侧的标签备选（含只遮不检的标签），保证「检测标签 ⊆ 遮盖标签」。 */
function looseLabelAlternation(category: MaskCategory): string {
  return LOOSE_LABEL_RULES.filter(([, value]) => value === category).map(([label]) => label).join('|')
}

const LOOSE_VALUE_LABEL = new RegExp(
  `(?:${[...LOOSE_LABEL_CATEGORY.keys()].join('|')})`,
  'gu',
)

// 电话号码的形状。修复前只有 PHONE（仅手机号 1[3-9]…），座机 / 400 热线 / 传真
// 一律遮不掉；而 `联系电话` `传真` 这些标签检测侧全都认识 —— 不对称就在这里。
// 每个备选都带明确前缀（0 / 400 / 800 / 1[3-9]），因此不会吞掉
// `2026-08-01` 这类带分隔符的日期（它们凑不出连续 7 位以上数字）。
const PHONE_HOTLINE = '(?:400|800)[\\s-]?\\d{3}[\\s-]?\\d{4}'
const PHONE_LANDLINE = '0\\d{2,3}[\\s-]?\\d{7,8}(?:\\s*(?:转|-)\\s*\\d{1,6})?'
const PHONE_MOBILE = '1[3-9](?:[\\s-]?\\d){9}'
const PHONE_LOCAL = '\\d{7,8}'
// 座机必须排在 PHONE_LOCAL 之前，否则 `021-62345678` 会被 \d{7,8} 截成前缀。
const LABELED_PHONE_VALUE =
  `(?:\\+?86[\\s-]?)?(?:${PHONE_HOTLINE}|${PHONE_LANDLINE}|${PHONE_MOBILE}|${PHONE_LOCAL})`
const LABELED_PHONE = new RegExp(
  `(?:${looseLabelAlternation('手机号')})\\s*[:：]?\\s*(${LABELED_PHONE_VALUE})`,
  'gu',
)

// 短账号。LABELED_BANK 要求 ≥16 位、BANK_CARD 要求 ≥16 位，于是
// `账号：622202123456`（12 位）遮不掉，而 `账号` 标签检测侧认识 —— 同一类不对称。
const LABELED_SHORT_ACCOUNT = new RegExp(
  `(?:${looseLabelAlternation('银行卡')})\\s*[:：]?\\s*(\\d[\\d\\s-]{4,30})`,
  'gu',
)

/**
 * 「数量」不是 PII：`证件2份` / `身份证复印件1份` 里的 `2份`、`1份`。
 *
 * 修复前检测侧只要看到标签后面跟着任意 `[0-9A-Za-z]` 就判残留，
 * 于是「入职需提交证件2份」这种纯事务性条款也会把整份合同判死。
 * 数量词天然与 PII 形状互斥（PII 不会是「≤4 位数字 + 量词」），
 * 所以这条豁免不会放过任何真实 PII。
 */
const QUANTITY_VALUE_AT = /\d{1,4}\s*(?:份|张|个|本|页|次|条|项|件|套|枚|人|名|位|部|台|种|类)/uy

const MASKED_NEXT_FIELD_PREFIXES = [
  /(?:身份证号?|证件|证件号码?)\s*[:：]?\s*\[身份证_\d+\]/uy,
  /(?:手机号?|联系电话|电话|联系号码|传真(?:号码?)?)\s*[:：]?\s*\[手机号_\d+\]/uy,
  /(?:电子邮箱|邮箱地址|邮箱)\s*[:：]?\s*\[邮箱_\d+\]/uy,
  /(?:银行卡号?|银行账户|银行账号|账户号?|账号)\s*[:：]?\s*\[银行卡_\d+\]/uy,
  /统一社会信用代码\s*[:：]?\s*\[统一社会信用代码_\d+\]/uy,
] as const
const PLACEHOLDER_AT = /\[(劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/uy
const FIELD_VALUE_SEPARATOR_AT = /(?:\s*[:：]\s*|\s+)/uy
const TAIL_SEPARATOR_AT = /[，,;；]\s*/uy
const PLACEHOLDER_CONNECTOR_AT = /(?:在|的)/uy

export interface MaskOptions {
  /**
   * 是否在遮盖结束后执行 assertNoHighConfidencePii 完整性断言（默认 true）。
   * 合同审查链路必须保持 true（fail-closed：断言不过就不许送模型）。
   * 关掉后调用方**必须自己承担**残留判定，见 common/pii/llm-input-mask.ts。
   */
  readonly assertComplete?: boolean

  /**
   * 是否在结果里带回 restoreMap（占位符 → 原文串），默认 false。
   *
   * 默认关闭是刻意的：restoreMap 的 value 是未脱敏 PII，
   * 合同链路不需要还原，也不应该拿到它。只有「产物要还给本人、
   * 必须把占位符换回真值」的简历链才显式开启。
   */
  readonly collectRestoreMap?: boolean
}

export function maskContractPages(pages: readonly ContractMaskPage[], options?: MaskOptions): ContractMaskResult {
  validatePages(pages)
  const source = pages.map((page) => page.text).join('\n')
  const compatibilitySource = source.normalize('NFKC')
  const knownEntities = extractKnownEntities(source)
  const searchWork = knownEntities.length * normalizeText(source).length
  if (knownEntities.length > MAX_UNIQUE_ENTITIES || !Number.isSafeInteger(searchWork) ||
      searchWork > MAX_ENTITY_SEARCH_WORK) throw new Error('CONTRACT_PII_MASK_ENTITY_LIMIT')
  const partyFacts = Object.freeze({
    hasPartyA: /(?:^|[\n\s])甲方\s*[:：]/u.test(compatibilitySource),
    hasPartyB: /(?:^|[\n\s])乙方\s*[:：]/u.test(compatibilitySource),
    hasEmployer: /(?:甲方|用人单位)(?:名称)?\s*[:：]/u.test(compatibilitySource),
    hasWorker: /(?:乙方|劳动者|姓名)\s*[:：]/u.test(compatibilitySource),
    hasUscc: hasMatch(compatibilitySource, USCC_LABEL) || hasMatch(compatibilitySource, USCC),
    hasBankAccount: hasMatch(compatibilitySource, BANK_LABEL) || containsLikelyBankAccount(compatibilitySource),
  })
  const placeholders = new Map<string, string>()
  const counters = new Map<MaskCategory, number>()
  let projectedOutputSize = 0
  const pagePlans = pages.map((page) => {
    const candidates = findCandidates(page.text, knownEntities)
    const selected = selectNonOverlapping(candidates)
    const replacements = selected.map((candidate) => ({
      ...candidate,
      placeholder: placeholderFor(candidate, placeholders, counters),
    }))
    let projectedLength = page.text.length
    for (const replacement of replacements) {
      projectedLength += replacement.placeholder.length - (replacement.end - replacement.start)
      if (!Number.isSafeInteger(projectedLength) || projectedLength < 0) throw new Error('CONTRACT_PII_MASK_OUTPUT_LIMIT')
    }
    const nextOutputSize = projectedOutputSize + projectedLength
    if (!Number.isSafeInteger(nextOutputSize) || nextOutputSize > MAX_OUTPUT_CODE_UNITS) throw new Error('CONTRACT_PII_MASK_OUTPUT_LIMIT')
    projectedOutputSize = nextOutputSize
    return { page, replacements, projectedLength }
  })
  // 占位符 → 原文串。仅在内存内用于还原（见 ContractMaskResult.restoreMap 的红线注释）。
  const restoreMap = new Map<string, string>()
  const maskedPages = pagePlans.map(({ page, replacements, projectedLength }) => {
    const chunks: string[] = []
    let cursor = 0
    for (const replacement of replacements) {
      chunks.push(page.text.slice(cursor, replacement.start), replacement.placeholder)
      // 同一占位符可能命中多处（不同书写形式归一到同一 key）；只记首次出现的原文串。
      if (!restoreMap.has(replacement.placeholder)) {
        restoreMap.set(replacement.placeholder, page.text.slice(replacement.start, replacement.end))
      }
      cursor = replacement.end
    }
    chunks.push(page.text.slice(cursor))
    const text = chunks.join('')
    if (text.length !== projectedLength) throw new Error('CONTRACT_PII_MASK_OUTPUT_LIMIT')
    return Object.freeze({ pageNumber: page.pageNumber, text })
  })
  if (options?.assertComplete !== false) assertNoHighConfidencePii(maskedPages)
  // 默认不带 restoreMap：键集保持 ['pages','partyFacts']，合同链路行为逐字不变。
  return options?.collectRestoreMap === true
    ? Object.freeze({ pages: Object.freeze(maskedPages), partyFacts, restoreMap })
    : Object.freeze({ pages: Object.freeze(maskedPages), partyFacts })
}

export function maskContractText(text: string): { readonly text: string; readonly partyFacts: ContractPartyFacts } { const output = maskContractPages([{ pageNumber: 1, text }]); return Object.freeze({ text: output.pages[0]!.text, partyFacts: output.partyFacts }) }

export function assertNoHighConfidencePii(pages: readonly ContractMaskPage[]): void {
  const normalizedPages = pages.map((page) => page.text.normalize('NFKC'))
  const virtualText = normalizedPages.join('')
  if (virtualText.length > MAX_INPUT_CODE_UNITS || hasMatch(virtualText, DOB_ID) || hasMatch(virtualText, EMAIL) || hasMatch(virtualText, USCC) || hasResidualSensitiveLabel(virtualText) || hasResidualLooseValueLabel(virtualText)) throw new Error(virtualText.length > MAX_INPUT_CODE_UNITS ? 'CONTRACT_PII_MASK_INPUT_LIMIT' : 'CONTRACT_PII_MASK_INCOMPLETE')
  let numericTail = ''
  for (const text of normalizedPages) {
    numericTail = scanNumericPii(numericTail, text)
    if (hasMatch(text, DOB_ID) || hasMatch(text, EMAIL) || hasMatch(text, USCC) ||
        hasResidualSensitiveLabel(text, false, false) || hasResidualLooseValueLabel(text, false, false)) {
      throw new Error('CONTRACT_PII_MASK_INCOMPLETE')
    }
  }
}

function scanNumericPii(tail: string, text: string): string {
  let offset = 0
  for (const date of text.matchAll(DATE_TOKEN)) {
    tail = scanNumericRange(tail, text, offset, date.index!)
    tail = /^\d{6}$/u.test(tail) ? `${tail}${digitsOnly(date[0])}` : ''
    offset = date.index! + date[0].length
  }
  return scanNumericRange(tail, text, offset, text.length)
}

function scanNumericRange(tail: string, text: string, start: number, end: number): string {
  for (let index = start; index < end; index += 1) {
    const character = text[index]!
    if ((character >= '0' && character <= '9') || character === 'X' || character === 'x') {
      tail = `${tail}${character.toUpperCase()}`.slice(-19)
      if (/^1[3-9]\d{9}$/u.test(tail.slice(-11)) ||
          isStrictIdentity(tail.slice(-15)) || isStrictIdentity(tail.slice(-18)) ||
          /\d{16}$/u.test(tail)) throw new Error('CONTRACT_PII_MASK_INCOMPLETE')
    } else if (!PII_SEPARATOR_CHAR.test(character)) tail = ''
  }
  return tail
}

function validatePages(pages: readonly ContractMaskPage[]): void {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('CONTRACT_PII_MASK_INVALID')
  if (pages.length > MAX_PAGES) throw new Error('CONTRACT_PII_MASK_INPUT_LIMIT')
  let size = 0
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index] as unknown
    if (!page || typeof page !== 'object') throw new Error('CONTRACT_PII_MASK_INVALID')
    const candidate = page as { pageNumber?: unknown; text?: unknown }
    if (candidate.pageNumber !== index + 1 || typeof candidate.text !== 'string') throw new Error('CONTRACT_PII_MASK_INVALID')
    if (candidate.text !== candidate.text.normalize('NFC') || /\r/u.test(candidate.text)) throw new Error('CONTRACT_PII_MASK_INVALID')
    size += candidate.text.length
    if (size > MAX_INPUT_CODE_UNITS) throw new Error('CONTRACT_PII_MASK_INPUT_LIMIT')
  }
}

function findCandidates(text: string, knownEntities: readonly KnownEntity[]): Candidate[] {
  const candidates: Candidate[] = []
  addKnownEntities(candidates, text, knownEntities)
  addCaptured(candidates, text, LABELED_WORKER, '劳动者', 140, normalizeText)
  addCaptured(candidates, text, LABELED_EMPLOYER, '用人单位', 140, normalizeText)
  addCaptured(candidates, text, LABELED_ADDRESS, '详细地址', 140, normalizeText)
  addLabeledNumber(candidates, text, LABELED_BANK, '银行卡', 160, digitsOnly, isBankAccount)
  addLabeledNumber(candidates, text, LABELED_ID, '身份证', 160, digitsAndX, isStrictIdentity)
  addLabeledNumber(candidates, text, LABELED_USCC, '统一社会信用代码', 160, normalizeText, isUscc)
  // 优先级低于上面三条严格规则（160），高于整值扫描（≤110）：
  // 既不改变既有分类结果，又保证「标签认识的值」一定有人遮。
  addLabeledNumber(candidates, text, LABELED_SHORT_ACCOUNT, '银行卡', 155, digitsOnly, isShortAccount)
  addLabeledNumber(candidates, text, LABELED_PHONE, '手机号', 150, normalizePhone, isPhoneNumber)
  const compatible = mapText(text, false)
  addMappedWhole(candidates, compatible, DOB_ID, '身份证', 110, digitsAndX)
  addMappedWhole(candidates, compatible, ID_18, '身份证', 100, digitsAndX)
  addMappedWhole(candidates, compatible, ID_15, '身份证', 100, digitsAndX)
  addMappedWhole(candidates, compatible, PHONE, '手机号', 85, normalizePhone)
  addMappedWhole(candidates, compatible, USCC, '统一社会信用代码', 90, normalizeText)
  addMappedWhole(candidates, compatible, EMAIL, '邮箱', 75, (value) => value.toLowerCase().replace('%40', '@'))
  addMappedWhole(candidates, compatible, BANK_CARD, '银行卡', 50, digitsOnly, true)
  return candidates
}

function addMappedWhole(
  target: Candidate[], mapped: MappedText, pattern: RegExp, category: MaskCategory,
  priority: number, normalize: (value: string) => string, protectDates = false,
): void {
  for (const match of mapped.text.matchAll(pattern)) {
    const value = match[0]
    if (match.index === undefined || !value || (protectDates && hasMatch(value, DATE_TOKEN))) continue
    const last = match.index + value.length - 1
    target.push({
      start: mapped.starts?.[match.index] ?? match.index,
      end: mapped.ends?.[last] ?? last + 1,
      category, key: normalize(value), priority,
    })
  }
}

function addCaptured(
  target: Candidate[], text: string, pattern: RegExp, category: MaskCategory,
  priority: number, normalize: (value: string) => string,
): void {
  for (const match of text.matchAll(pattern)) {
    const value = match[1]
    if (match.index === undefined || !value) continue
    const offset = match[0].indexOf(value)
    const start = match.index + offset
    target.push({ start, end: start + value.length, category, key: normalize(value), priority })
  }
}

function addLabeledNumber(
  target: Candidate[], text: string, pattern: RegExp, category: MaskCategory,
  priority: number, normalize: (value: string) => string, validate: (value: string) => boolean,
): void {
  for (const match of text.matchAll(pattern)) {
    const raw = match[1]
    if (match.index === undefined || !raw) continue
    const value = raw.replace(/[\s-]+$/gu, '')
    if (!validate(value)) continue
    const offset = match[0].indexOf(raw)
    const start = match.index + offset
    target.push({ start, end: start + value.length, category, key: normalize(value), priority })
  }
}

function selectNonOverlapping(candidates: readonly Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority || a.start - b.start || b.end - a.end)
  const selected: Candidate[] = []
  const occupied = new Uint8Array(sorted.reduce((end, candidate) => Math.max(end, candidate.end), 0))
  for (const candidate of sorted) {
    let overlaps = false
    for (let index = candidate.start; index < candidate.end; index += 1) {
      if (occupied[index]) {
        overlaps = true
        break
      }
    }
    if (overlaps) continue
    occupied.fill(1, candidate.start, candidate.end)
    selected.push(candidate)
  }
  return selected.sort((a, b) => a.start - b.start)
}

function extractKnownEntities(text: string): KnownEntity[] {
  const entities: KnownEntity[] = []
  const seen = new Set<string>()
  for (const [pattern, category] of [
    [LABELED_WORKER, '劳动者'],
    [LABELED_EMPLOYER, '用人单位'],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]
      if (!value) continue
      const key = normalizeText(value)
      const identity = `${category}:${key}`
      if (!seen.has(identity)) {
        seen.add(identity)
        entities.push({ category, key })
      }
    }
  }
  return entities
}

function addKnownEntities(target: Candidate[], text: string, entities: readonly KnownEntity[]): void {
  if (entities.length === 0) return
  const mapped = mapText(text, true)
  for (const entity of entities) {
    let start = mapped.text.indexOf(entity.key)
    while (start >= 0) {
      const last = start + entity.key.length - 1
      target.push({
        start: mapped.starts?.[start] ?? start,
        end: mapped.ends?.[last] ?? last + 1,
        category: entity.category,
        key: entity.key,
        priority: 110,
      })
      start = mapped.text.indexOf(entity.key, start + entity.key.length)
    }
  }
}

function isStrictIdentity(value: string): boolean {
  const compact = digitsAndX(value)
  return /^\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9X]$/u.test(compact) ||
    /^\d{8}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}$/u.test(compact)
}

function isBankAccount(value: string): boolean { return /^\d{16,19}$/u.test(digitsOnly(value)) || value.normalize('NFKC').match(DATE_TOKEN)?.length === 2 }

/**
 * 显式账号标签下的短账号（6–19 位）。银行卡是 16–19 位，但工资卡以外的
 * 内部账号 / 折号常常更短 —— 标签既然写了「账号」，就按 PII 处理。
 */
function isShortAccount(value: string): boolean {
  const digits = digitsOnly(value)
  return digits.length >= 6 && digits.length <= 19
}

/** 电话号码位数上下界（含 86 国码时最长 13 位，留到 15 位兼容分机）。 */
function isPhoneNumber(value: string): boolean {
  const digits = digitsOnly(value)
  return digits.length >= 7 && digits.length <= 15
}

function containsLikelyBankAccount(text: string): boolean {
  for (const match of text.matchAll(BANK_CARD)) {
    if (!isStrictIdentity(match[0]) && !hasMatch(match[0], DATE_TOKEN)) return true
  }
  return false
}

function isUscc(value: string): boolean { return /^[0-9A-HJ-NPQRTUWXY]{18}$/u.test(normalizeText(value)) }

function placeholderFor(
  candidate: Candidate, placeholders: Map<string, string>, counters: Map<MaskCategory, number>,
): string {
  const key = `${candidate.category}:${candidate.key}`
  const existing = placeholders.get(key)
  if (existing) return existing
  const next = (counters.get(candidate.category) ?? 0) + 1
  counters.set(candidate.category, next)
  const placeholder = `[${candidate.category}_${next}]`
  placeholders.set(key, placeholder)
  return placeholder
}

function hasMatch(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0
  const matched = pattern.test(text)
  pattern.lastIndex = 0
  return matched
}

function hasResidualSensitiveLabel(text: string, checkTail = true, checkMissing = true): boolean {
  for (const match of text.matchAll(SENSITIVE_LABEL)) {
    const expected = sensitiveLabelCategory(match[1] ?? '')
    const tail = consumePlaceholderAt(text, (match.index ?? 0) + match[0].length, expected)
    if ((tail === null && checkMissing) || (tail !== null && checkTail && !isAllowedPlaceholderTailAt(text, tail))) return true
  }
  return false
}

function hasResidualLooseValueLabel(text: string, checkTail = true, checkMissing = true): boolean {
  for (const match of text.matchAll(LOOSE_VALUE_LABEL)) {
    const matchStart = match.index ?? 0
    if (matchStart > 0 && text[matchStart - 1] === '[') continue
    // 标签集合与类别都来自 LOOSE_LABEL_RULES，正则也由它派生，因此这里必然命中。
    // 万一将来有人只改了正则没改表，取不到类别就按残留处理（fail-closed）。
    const expected = LOOSE_LABEL_CATEGORY.get(match[0])
    if (expected === undefined) return true
    const suffixStart = matchStart + match[0].length
    const separated = execAt(FIELD_VALUE_SEPARATOR_AT, text, suffixStart)
    const valueStart = separated?.index === suffixStart ? suffixStart + separated[0].length : suffixStart
    const tail = consumePlaceholderAt(text, valueStart, expected)
    if (tail !== null) {
      if (checkTail && !isAllowedPlaceholderTailAt(text, tail)) return true
      continue
    }
    if (checkMissing && isResidualValueAt(text, valueStart)) return true
  }
  return false
}

/**
 * 标签后面的这段文字算不算「没遮干净的值」。
 *
 * 保留原有的 fail-closed 口径：只要是 `[` 或 `[+0-9A-Za-z._-]` 就算残留 ——
 * `银行卡 abc-def` 这类 OCR 乱码必须继续判死（见 pii-masker.test.ts 的
 * 「fails closed when a high-confidence value survives…」）。
 * **唯一**放宽的是数量词，理由见 QUANTITY_VALUE_AT。
 */
function isResidualValueAt(text: string, offset: number): boolean {
  if (execAt(QUANTITY_VALUE_AT, text, offset)) return false
  return text[offset] === '[' || /[+0-9A-Za-z._-]/u.test(text[offset] ?? '')
}

function sensitiveLabelCategory(label: string): MaskCategory {
  if (/^(?:姓名|乙方|劳动者)$/u.test(label)) return '劳动者'
  if (/^(?:甲方|用人单位(?:名称)?)$/u.test(label)) return '用人单位'
  return '详细地址'
}

function consumePlaceholderAt(text: string, offset: number, expected: MaskCategory): number | null {
  const match = execAt(PLACEHOLDER_AT, text, offset)
  if (!match || match[1] !== expected) return null
  return offset + match[0].length
}

function isAllowedPlaceholderTailAt(text: string, offset: number): boolean {
  let cursor = offset
  while (cursor < text.length) {
    if (text[cursor] === '。' || text[cursor] === '\n') return true
    const separator = execAt(TAIL_SEPARATOR_AT, text, cursor)
    cursor = separator ? cursor + separator[0].length : skipWhitespace(text, cursor)
    if (cursor >= text.length || text[cursor] === '。' || text[cursor] === '\n') return true
    const placeholder = execAt(PLACEHOLDER_AT, text, cursor); if (placeholder) { cursor += placeholder[0].length; continue }
    const connector = execAt(PLACEHOLDER_CONNECTOR_AT, text, cursor); if (connector) { cursor += connector[0].length; continue }
    if (execAt(NEXT_FIELD_AT, text, cursor)) return true
    const fact = execAt(SAFE_LEGAL_FACT_AT, text, cursor)
    if (fact) {
      cursor += fact[0].length
      continue
    }
    const boilerplate = execAt(SAFE_BOILERPLATE_AT, text, cursor)
    if (boilerplate) {
      cursor += boilerplate[0].length
      continue
    }
    let matchedField = false
    for (const pattern of MASKED_NEXT_FIELD_PREFIXES) {
      const field = execAt(pattern, text, cursor)
      if (!field) continue
      cursor += field[0].length
      matchedField = true
      break
    }
    if (!matchedField) return false
  }
  return true
}

function execAt(pattern: RegExp, text: string, offset: number): RegExpExecArray | null {
  pattern.lastIndex = offset
  const match = pattern.exec(text)
  return match?.index === offset ? match : null
}

function skipWhitespace(text: string, offset: number): number {
  let cursor = offset
  while (cursor < text.length && /\s/u.test(text[cursor]!)) cursor += 1
  return cursor
}

function mapText(source: string, compact: boolean): MappedText {
  const text = compact ? normalizeText(source) : source.normalize('NFKC')
  if (text === source) return { text }
  const starts = new Uint32Array(text.length)
  const ends = new Uint32Array(text.length)
  let rebuilt = ''
  let mappedOffset = 0
  for (let start = 0; start < source.length;) {
    const raw = String.fromCodePoint(source.codePointAt(start)!)
    const end = start + raw.length
    const normalized = compact ? normalizeText(raw) : raw.normalize('NFKC')
    rebuilt += normalized
    for (let index = 0; index < normalized.length; index += 1) {
      if (mappedOffset >= text.length) throw new Error('CONTRACT_PII_MASK_INCOMPLETE')
      starts[mappedOffset] = start
      ends[mappedOffset] = end
      mappedOffset += 1
    }
    start = end
  }
  if (rebuilt !== text || mappedOffset !== text.length) throw new Error('CONTRACT_PII_MASK_INCOMPLETE')
  return { text, starts, ends }
}

function digitsOnly(value: string): string { return value.replace(/\D/gu, '') }

function normalizePhone(value: string): string {
  const digits = digitsOnly(value)
  return digits.length === 13 && digits.startsWith('86') ? digits.slice(2) : digits
}

function digitsAndX(value: string): string { return value.replace(/[^0-9Xx]/gu, '').toUpperCase() }

function normalizeText(value: string): string { return value.normalize('NFKC').replace(/\s+/gu, '').toUpperCase() }
