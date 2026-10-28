/**
 * 统一社会信用代码（GB 32100-2015）：18 位，字符集 0-9 与 A-Y 去掉 I O S V Z（共 31 个），
 * 第 18 位是前 17 位按权重加权后对 31 取模得到的校验位。
 * 只看格式 + 校验位，不联网核验真伪——真伪核验是线下合同流程的事。
 */
const CHARSET = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28] as const
const FORMAT = /^[0-9A-HJ-NPQRTUWXY]{18}$/

/** 去首尾空白并转大写；格式不对返回 null。 */
export function normalizeCreditCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  if (!FORMAT.test(code)) return null
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += CHARSET.indexOf(code[i]!) * WEIGHTS[i]!
  const check = (31 - (sum % 31)) % 31
  return CHARSET[check] === code[17] ? code : null
}
