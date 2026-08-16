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
// 所以本文件的策略是：**遮盖照做，断言只用于观测**。
//   - 相对现状（原文直送）是严格改善，不可能更差；
//   - 断言未通过时不静默：落一条不含原文的 warn，供后续按真实样本收敛规则；
//   - 任何异常路径都不会退回「送原文」，最差也走 FALLBACK_PATTERNS 兜底遮盖。
//
// 合规口径：本文件只负责「送模型前遮盖」。它不承诺遮盖 100% 完备，
// 因此**不得**据此对用户宣称「简历不会出境」；同意授权文案仍须如实说明
// 简历全文会发送给第三方模型服务商做分析，本层只遮盖可识别的高置信 PII。
//
// 日志红线：本文件任何路径都不打印被处理的文本原文或摘录。
// ============================================================

import { Logger } from '@nestjs/common'
import { assertNoHighConfidencePii, maskContractPages } from './pii-masker'

const logger = new Logger('LlmInputMask')

/**
 * 单次遮盖的输入上限。调用方本来就会把简历切到 8000–12000 字再拼 prompt，
 * 这里只是兜底：把引擎的实体搜索工作量钉死在安全区间内
 * （MAX_UNIQUE_ENTITIES=256 × 20000 字 ≈ 5.1M < MAX_ENTITY_SEARCH_WORK=10M）。
 */
const MAX_MASK_INPUT_CHARS = 20_000

/**
 * 最后一道兜底：遮盖引擎本身抛错（理论上不该发生，输入已被规整并限长）时使用。
 * 只覆盖无歧义的高置信模式，宁可漏遮也不误伤正文；绝不退回送原文。
 */
const FALLBACK_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![0-9A-Za-z])\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9A-Za-z])/gu, '[身份证]'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[手机号]'],
  [/(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/giu, '[邮箱]'],
  [/(?<!\d)\d{16,19}(?!\d)/gu, '[银行卡]'],
]

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

/**
 * 送模型前遮盖用户材料里的高置信 PII。
 *
 * 永不抛错、永不返回未处理的原文 —— 上游简历链一旦因为脱敏挂掉，
 * 等于用一个合规加固换掉一个已验证闭环。
 *
 * @param raw   用户材料原文（简历正文、扫描 OCR 文本等）
 * @param scene 只用于日志定位的场景标识，**不得**传入任何用户内容
 */
export function maskUserTextForLlm(raw: string, scene: string): LlmInputMaskResult {
  const normalized = normalizeForMask(raw)
  if (!normalized) return { text: '', changed: false, strict: true, degraded: false }

  try {
    // assertComplete=false：先无条件拿到遮盖结果，断言另算（理由见文件头）
    const masked = maskContractPages([{ pageNumber: 1, text: normalized }], { assertComplete: false })
    const text = masked.pages[0]!.text
    let strict = true
    try {
      assertNoHighConfidencePii(masked.pages)
    } catch {
      strict = false
      // 只报场景与长度，不报原文/摘录/命中值
      logger.warn(`llm_input_mask.residual scene=${scene} chars=${normalized.length}`)
    }
    return { text, changed: text !== normalized, strict, degraded: false }
  } catch (error) {
    // 引擎异常（超限 / 输入非法等）：退到兜底正则，绝不退到「送原文」
    logger.warn(
      `llm_input_mask.engine_failed scene=${scene} chars=${normalized.length} ` +
      `code=${error instanceof Error ? error.message : 'UNKNOWN'}`,
    )
    let text = normalized
    for (const [pattern, placeholder] of FALLBACK_PATTERNS) text = text.replace(pattern, placeholder)
    return { text, changed: text !== normalized, strict: false, degraded: true }
  }
}

/** 便捷形态：只要遮盖后的文本。 */
export function maskUserTextForLlmText(raw: string, scene: string): string {
  return maskUserTextForLlm(raw, scene).text
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
