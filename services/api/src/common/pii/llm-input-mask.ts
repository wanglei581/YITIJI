// ============================================================
// LLM 入参 PII 遮盖（S0-2 / 风险 R2）
//
// 背景：合同审查（E 组）是全站唯一在喂模型前做 PII 脱敏的链路，
// 而简历链（A 组）与定向输出链（B 组）把简历原文**未脱敏**直送第三方模型。
// 简历里的姓名 / 手机号 / 身份证号 / 邮箱 / 住址会原样出境。
//
// 全站三种 PII 策略，本文件是第一种：
//   1. 脱敏（mask）  —— 有归属、且必须被分析的用户材料。合同审查、简历链（本文件）。
//   2. 拒绝（reject）—— 匿名、无主、业务上根本不需要 PII 的自由文本。
//                       见 member-feedback/kiosk-feedback-text.ts。
//   3. 无            —— 不允许再新增。
// 简历**必须被接收才能分析**，所以照搬匿名反馈的「拒绝」策略行不通，只能脱敏。
//
// ── 为什么不直接沿用合同链路的 fail-closed 断言 ──────────────────────────
// maskContractPages 默认在结尾跑 assertNoHighConfidencePii，遮盖不干净就抛错。
// 那套断言是按**劳动合同**的文本形态调过的，直接套到简历上有确定的假阳性：
// 例如 assertNoHighConfidencePii 里的数字游程扫描把空白/点/连字符都当分隔符，
// 简历里连续几段「2015.09-2019.06  2019.07-2023.06」的教育/工作时间轴会累积出
// 16 位以上连续数字，被判成银行卡而抛 CONTRACT_PII_MASK_INCOMPLETE
// （这些日期又不被 DATE_TOKEN 识别，无法在扫描中被重置）。
//
// 如果照抄 fail-closed，这类简历会直接打死简历诊断 / 岗位匹配 / 职业规划 —— 那是
// 把一个已上线闭环换成不可用，违反「AI 是加速器不是前置条件，功能可退化不可瘫痪」。
// 所以正常路径的策略是：**遮盖照做，断言只用于观测**。
//   - 断言未通过时不静默：落一条不含原文的 warn，供后续按真实样本收敛规则；
//   - 引擎异常时先走 FALLBACK_PATTERNS，再作最终残留断言；只有安全的兜底结果
//     可以返回。无法确认遮盖完成则以通用 503 停止送模，仍可用手工编辑与打印。
//
// 合规口径：本文件只负责「送模型前遮盖」。它不承诺遮盖 100% 完备，
// 因此**不得**据此对用户宣称「简历不会出境」；同意授权文案仍须如实说明
// 简历全文会发送给第三方模型服务商做分析，本层只遮盖可识别的高置信 PII。
//
// 日志红线：本文件任何路径都不打印被处理的文本原文或摘录。
// ============================================================

import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { assertNoHighConfidencePii, maskContractPages } from './pii-masker'

const logger = new Logger('LlmInputMask')

/**
 * 单次遮盖的输入上限。调用方本来就会把简历切到 8000–12000 字再拼 prompt，
 * 这里只是兜底：把引擎的实体搜索工作量钉死在安全区间内
 * （MAX_UNIQUE_ENTITIES=256 × 20000 字 ≈ 5.1M < MAX_ENTITY_SEARCH_WORK=10M）。
 */
const MAX_MASK_INPUT_CHARS = 20_000

/**
 * 对外暴露的输入上限。调用方若要把多段文本拼成一次遮盖调用（保证占位符编号一致），
 * 必须自己按这个上限分配预算 —— 超限会被 normalizeForMask 静默截断，
 * 拼接场景下截断掉的是后半段，会直接毁掉结构化载荷。
 */
export const LLM_MASK_INPUT_LIMIT = MAX_MASK_INPUT_CHARS

/**
 * 最后一道兜底：遮盖引擎本身抛错（理论上不该发生，输入已被规整并限长）时使用。
 * 只覆盖无歧义的高置信模式；完成后仍须通过最终残留断言，不完整就停止送模。
 */
const FALLBACK_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![0-9A-Za-z])\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9A-Za-z])/gu, '身份证'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '手机号'],
  [/(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/giu, '邮箱'],
  [/(?<!\d)\d{16,19}(?!\d)/gu, '银行卡'],
]

/**
 * 遮盖占位符 token，形态与 pii-masker 的 placeholderFor 输出严格一致。
 * 用于把模型回包里的占位符换回原值。
 */
const PLACEHOLDER_TOKEN =
  /\[(?:劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/gu

export interface LlmInputMaskResult {
  /** 遮盖后的文本。**这就是应当送模型的文本**，调用方不得再用原文拼 prompt。 */
  readonly text: string
  /** 是否发生过替换（文本与规整后的输入不同） */
  readonly changed: boolean
  /** 是否通过合同链路那套完整性断言。false 只代表「可能有残留」，不代表遮盖没做 */
  readonly strict: boolean
  /** 兜底路径是否被触发（正常情况下恒为 false；为 true 说明遮盖引擎抛了错） */
  readonly degraded: boolean
}

export interface LlmInputMaskReversibleResult extends LlmInputMaskResult {
  /**
   * 把模型回包里的占位符还原成原值；未知占位符原样保留（模型可能编造）。
   *
   * ⚠️ 只能作用于**要交还给本人**的产物（优化后的简历、前后对比文本）。
   * 禁止把还原结果再送模型、写日志或落到与本人无关的存储里。
   */
  restore(value: string): string
}

/** 空映射时 restore 是恒等函数；有映射时按 token 精确替换。 */
function makeRestore(map: ReadonlyMap<string, string>): (value: string) => string {
  return (value: string): string => {
    if (typeof value !== 'string' || value.length === 0 || map.size === 0) return typeof value === 'string' ? value : ''
    return value.replace(PLACEHOLDER_TOKEN, (token) => map.get(token) ?? token)
  }
}

/**
 * 遮盖选项。
 *
 * keepNames：只遮高置信的号码类与地址（身份证 / 手机号 / 银行卡 / 邮箱 / 详细地址 /
 * 统一社会信用代码），**不遮**「姓名：」「甲方：」一类名称。
 * 给小青文字对话用 —— 称呼被遮掉，对话就接不上了；名字本身也不是高置信敏感项。
 * 简历链、模拟面试不传（名字照遮）。
 * 引擎异常时，兜底的最终断言仍可能因姓名标签拒绝；此档不放宽异常档的安全要求。
 */
export interface LlmInputMaskOptions {
  readonly keepNames?: boolean
}

export interface LlmInputMaskManyResult extends Omit<LlmInputMaskReversibleResult, 'text'> {
  /** 与输入逐一对应的遮盖后文本。**这就是应当送模型的文本**。 */
  readonly texts: string[]
}

/**
 * 送模型前遮盖用户材料里的高置信 PII。
 *
 * 正常路径保留简历日期等兼容行为；引擎异常后的兜底若仍有高置信残留，
 * 抛通用 503，调用方不得继续发送材料。没有 PII 的安全正文可以保持原样。
 *
 * @param raw   用户材料原文（简历正文、扫描 OCR 文本等）
 * @param scene 只用于日志定位的场景标识，**不得**传入任何用户内容
 */
export function maskUserTextForLlm(raw: string, scene: string, options?: LlmInputMaskOptions): LlmInputMaskResult {
  return maskUserTextForLlmReversible(raw, scene, options)
}

/**
 * 与 maskUserTextForLlm 完全相同的遮盖行为，额外返回 restore()。
 *
 * 用于「产物要还给本人」的链路（简历优化 / 排版调整）：模型只看得到占位符，
 * 回包里的占位符在服务端换回原值，用户拿到的简历仍是完整真值。
 */
export function maskUserTextForLlmReversible(
  raw: string,
  scene: string,
  options?: LlmInputMaskOptions,
): LlmInputMaskReversibleResult {
  const { texts, ...rest } = maskUserTextsForLlmReversible([raw], scene, options)
  return { ...rest, text: texts[0] ?? '' }
}

/**
 * 多段一起遮：各段分别送回，但**占位符编号全局一致**（同一个手机号在第 1 段和第 5 段
 * 都是 `[手机号_1]`），restore() 对任一段都有效。
 *
 * 为什么不把多段拼成一个字符串再遮：拼接后「地址：」这类带标签的规则会越过段落边界
 * 把下一段吞进去，再按分隔符拆回时就错位了。这里把每段当作遮盖引擎的一「页」，
 * 引擎本来就按页处理、跨页共享编号，不存在越界问题。
 *
 * 用于：模拟面试（简历摘要 + 每轮作答）、小青对话（多轮历史）、简历生成（多条描述）。
 * 段数超过引擎页数上限（50）或总量超限时走兜底正则；通过最终残留断言才返回。
 */
export function maskUserTextsForLlmReversible(
  raws: readonly string[],
  scene: string,
  options?: LlmInputMaskOptions,
): LlmInputMaskManyResult {
  const normalized = (Array.isArray(raws) ? raws : []).map((raw) => normalizeForMask(raw))
  if (normalized.every((text) => !text)) {
    return { texts: normalized, changed: false, strict: true, degraded: false, restore: (value) => value }
  }
  const chars = normalized.reduce((sum, text) => sum + text.length, 0)

  try {
    // assertComplete=false：先无条件拿到遮盖结果，断言另算（理由见文件头）
    const masked = maskContractPages(
      normalized.map((text, index) => ({ pageNumber: index + 1, text })),
      { assertComplete: false, collectRestoreMap: true, maskPartyNames: options?.keepNames !== true },
    )
    const texts = masked.pages.map((page) => page.text)
    let strict = true
    try {
      assertNoHighConfidencePii(masked.pages)
    } catch {
      strict = false
      // 只报场景与长度，不报原文/摘录/命中值
      logger.warn(`llm_input_mask.residual scene=${scene} chars=${chars}`)
    }
    return {
      texts,
      changed: texts.some((text, index) => text !== normalized[index]),
      strict,
      degraded: false,
      restore: makeRestore(masked.restoreMap ?? new Map()),
    }
  } catch (error) {
    // 引擎异常（超限 / 输入非法等）：退到兜底正则，绝不退到「送原文」
    logger.warn(
      `llm_input_mask.engine_failed scene=${scene} chars=${chars} ` +
      `code=${error instanceof Error ? error.message : 'UNKNOWN'}`,
    )
    // 兜底路径同样产出 `[类别_序号]`，且跨段共用编号，保证 restore() 在降级时依然可用
    const fallbackMap = new Map<string, string>()
    const seqByCategory = new Map<string, number>()
    const texts = normalized.map((segment) => {
      let text = segment
      for (const [pattern, category] of FALLBACK_PATTERNS) {
        text = text.replace(pattern, (hit) => {
          for (const [token, original] of fallbackMap) {
            if (original === hit && token.startsWith(`[${category}_`)) return token
          }
          const seq = (seqByCategory.get(category) ?? 0) + 1
          seqByCategory.set(category, seq)
          const token = `[${category}_${seq}]`
          fallbackMap.set(token, hit)
          return token
        })
      }
      return text
    })
    // 引擎已失效，不能把仅覆盖部分模式的正则结果当作遮盖成功继续送模。
    // 正常路径的观测档不变；异常档的保守拒绝不影响手工编辑与打印。
    try {
      assertNoHighConfidencePii(texts.map((text, index) => ({ pageNumber: index + 1, text })))
    } catch {
      throw new ServiceUnavailableException({
        error: {
          code: 'AI_INPUT_MASK_UNAVAILABLE',
          message: 'AI输入隐私检查暂未完成，请稍后重试，或使用手工编辑与打印',
        },
      })
    }
    return {
      texts,
      changed: texts.some((text, index) => text !== normalized[index]),
      strict: false,
      degraded: true,
      restore: makeRestore(fallbackMap),
    }
  }
}

/** 便捷形态：只要遮盖后的文本。 */
export function maskUserTextForLlmText(raw: string, scene: string, options?: LlmInputMaskOptions): string {
  return maskUserTextForLlm(raw, scene, options).text
}

/** 便捷形态（多段、不可还原）：只要遮盖后的各段文本。 */
export function maskUserTextsForLlmText(raws: readonly string[], scene: string, options?: LlmInputMaskOptions): string[] {
  return maskUserTextsForLlmReversible(raws, scene, options).texts
}

/** 是否还残留遮盖占位符（模型编造了不存在的编号时 restore 会原样保留它）。 */
export function containsMaskPlaceholder(value: string): boolean {
  PLACEHOLDER_TOKEN.lastIndex = 0
  const hit = typeof value === 'string' && PLACEHOLDER_TOKEN.test(value)
  PLACEHOLDER_TOKEN.lastIndex = 0
  return hit
}

/**
 * 规整成遮盖引擎能接受的形状：
 * 引擎的 validatePages 要求 NFC、无 \r、单页 ≤ MAX_INPUT_CODE_UNITS。
 * 提取出来的简历文本经常带 \r\n（Windows 端 / PDF 抽取），必须先归一，
 * 否则会被判 CONTRACT_PII_MASK_INVALID 而白白走兜底路径。
 */
function normalizeForMask(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  return raw.replace(/\r\n?/gu, '\n').normalize('NFC').slice(0, MAX_MASK_INPUT_CHARS)
}
