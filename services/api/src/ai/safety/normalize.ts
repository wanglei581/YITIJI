/**
 * 繁体到简体。只覆盖词库和测试题里出现的字，每两个字是「简、繁」。
 * 同一个简体字可以对应多个繁体（历歷 / 历曆）。
 */
const TRADITIONAL_PAIRS =
  '杀殺买買凶兇网網络絡赌賭药藥弹彈动動组組织織独獨国國袭襲击擊伤傷约約卖賣枪槍装裝换換脸臉证證学學历歷历曆经經单單贷貸银銀带帶盗盜软軟码碼窃竊机機携攜残殘筛篩汉漢岁歲怀懷发發离離职職书書识識诈詐渗滲测測闹鬧复復复複团團泼潑浓濃谣謠编編闻聞圣聖为為门門开開关關东東车車长長这這对對时時会會说說话話请請問問題題应應从從业業帮幫写寫过過还還让讓给給后後现現电電号號际際录錄伪偽伪僞险險仅僅节節条條练練雇僱'

const TRADITIONAL = new Map<string, string>()
{
  const chars = [...TRADITIONAL_PAIRS]
  for (let i = 0; i + 1 < chars.length; i += 2) {
    TRADITIONAL.set(chars[i + 1]!, chars[i]!)
  }
}

/** 空格和常见插字。不删句读，避免两句话被粘成一个词。用码点集合，不把零宽字符写进字符类。 */
const STRIP_CODES = new Set<number>([
  0x00a0, 0x3000, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad,
  0x00b7, 0x2022, 0x30fb, 0xff65, 0x2e, 0x5f, 0x2d, 0x2a, 0x7e, 0xff5e,
  0x2014, 0x2013, 0x2015, 0xff3f, 0x2f, 0x5c, 0x7c,
])

function isStripChar(char: string): boolean {
  if (/\s/u.test(char)) return true
  const code = char.codePointAt(0) ?? 0
  return STRIP_CODES.has(code)
}

/** NFKC（全角转半角）→ 小写 → 繁转简 → 去插入符号。 */
export function normalizeForSafety(value: string): string {
  const folded = value.normalize('NFKC').toLowerCase()
  let simplified = ''
  for (const char of folded) simplified += TRADITIONAL.get(char) ?? char
  let stripped = ''
  for (const char of simplified) {
    if (!isStripChar(char)) stripped += char
  }
  return stripped
}
