/**
 * 匿名一体机反馈自由文本的清洗与 PII 拒绝。
 *
 * 口径：匿名面**不收** PII。一体机是公共位设备，匿名工单没有账号归属，
 * 一旦落进手机号/身份证/银行卡/邮箱，就是无主的敏感数据，删除与追责都无从下手。
 * 因此这里是「拒绝」而不是「脱敏」—— 脱敏等于先接收再处理，原文仍会穿过进程与日志。
 *
 * 清洗与检测刻意用不同的规范化强度：
 *   - 入库文本用 NFC：只合并等价组合字，保留全角标点。用 NFKC 会把「，」折成「,」、
 *     「（）」折成「()」，那是在改用户写下的内容，不是清洗。
 *   - PII 检测内部再套一层 NFKC：把全角数字（１３８…）折回半角，
 *     并对「只保留数字」的投影再判一次，防止用空格 / 短横线 / 点号切断数字串绕过。
 *
 * 本模块任何路径都不打印原文。
 */

/**
 * 零宽 / 双向控制字符码点：可用于切断数字串绕过检测，必须先剥掉。
 * 用码点集合而不是控制字符正则，源码保持可读 ASCII。
 */
function isZeroWidth(cp: number): boolean {
  return (cp >= 0x200b && cp <= 0x200f) // ZWSP..RLM
    || (cp >= 0x202a && cp <= 0x202e)   // LRE..RLO
    || (cp >= 0x2060 && cp <= 0x2064)   // WJ..invisible plus
    || cp === 0xfeff                    // BOM / ZWNBSP
}

/** C0 / DEL / C1 控制字符（含换行、制表）。 */
function isControlChar(cp: number): boolean {
  return cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)
}

export type KioskFeedbackPiiRule = 'phone' | 'id_card' | 'email' | 'long_digit_run'

export interface KioskFeedbackPiiHit {
  /** 命中的规则名。只回规则名，绝不回原文片段。 */
  rule: KioskFeedbackPiiRule
}

/**
 * 清洗：NFC 规范化 → 剥零宽 → 控制字符折空格 → 折叠连续空白 → trim。
 * 只去掉不可见 / 可用于绕过检测的部分，不改变可见语义（全角标点原样保留）。
 */
export function sanitizeKioskFeedbackText(raw: string): string {
  let out = ''
  for (const ch of raw.normalize('NFC')) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    if (isZeroWidth(cp)) continue
    out += isControlChar(cp) ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** 数字投影：丢掉数字之间的常见分隔符，暴露被切断的长数字串。 */
function digitProjection(text: string): string {
  return text.replace(/[\s\-–—_.·、/\\()]/g, '')
}

/**
 * 返回命中的 PII 规则；无命中返回 null。
 * 输入应当是 sanitizeKioskFeedbackText 的输出。
 */
export function detectKioskFeedbackPii(text: string): KioskFeedbackPiiHit | null {
  // 检测侧独立套 NFKC：把全角数字 / 全角 @ 折回半角，堵住全角绕过。
  // 折叠结果只用于判定，不会被写回入库文本。
  const folded = text.normalize('NFKC')
  if (/[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.test(folded)) return { rule: 'email' }

  for (const candidate of [folded, digitProjection(folded)]) {
    // 身份证：18 位（末位可 X）或 15 位纯数字。先判，避免被 long_digit_run 抢走归因。
    if (/(?<![0-9A-Za-z])[1-9][0-9]{16}[0-9Xx](?![0-9A-Za-z])/.test(candidate)) return { rule: 'id_card' }
    if (/(?<!\d)[1-9]\d{14}(?!\d)/.test(candidate)) return { rule: 'id_card' }
    // 中国大陆手机号。
    if (/(?<!\d)1[3-9]\d{9}(?!\d)/.test(candidate)) return { rule: 'phone' }
    // 兜底：任何 ≥11 位连续数字（银行卡、变体证件号）。
    // 打印/扫描现场问题描述没有正当理由出现 11 位以上数字串；
    // 任务号有 relatedPrintTaskId / relatedScanTaskId 专用字段，不走自由文本。
    if (/\d{11,}/.test(candidate)) return { rule: 'long_digit_run' }
  }
  return null
}
