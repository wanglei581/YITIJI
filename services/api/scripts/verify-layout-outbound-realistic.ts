/**
 * 排版出站按现实写法遮号码。
 *
 * 全角数字先折成半角再检测。分段只隔一个空格、短横、点或零宽字符、
 * 合计达到 11 位的，按一整串遮。简历 JSON 里相邻的数字字段拼起来再遮。
 * 出站正文去掉这些分隔符、折成半角之后，拼不出原号码。还原与原文逐字一致。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:layout-outbound-realistic
 */
import { maskLayoutAdjustOutbound } from '../src/ai/resume/layout-adjust-mask'

let passCount = 0

function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  throw new Error(message)
}

function foldDigits(text: string): string {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const code = char.charCodeAt(0)
    if (code >= 0xff10 && code <= 0xff19) out += String.fromCharCode(code - 0xff10 + 0x30)
    else if (char === 'Ｘ' || char === 'ｘ') out += 'X'
    else out += char
  }
  return out
}

/** 去掉现实分隔符再折半角，只留数字。用来判断出站还能不能拼回原号码。 */
function recoverableDigits(text: string): string {
  const folded = foldDigits(text)
  let out = ''
  for (let index = 0; index < folded.length; index += 1) {
    const char = folded[index] ?? ''
    if (char >= '0' && char <= '9') out += char
  }
  return out
}

function toFullwidthDigits(text: string): string {
  return text.replace(/\d/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0x30 + 0xff10))
}

function assertCovered(label: string, raw: string, secretDigits: string, json?: string): void {
  const original = `说明${raw}结束`
  const resumeJson = json ?? JSON.stringify({ summary: raw })
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: raw,
    resumeJson,
    maxOriginalChars: original.length + 800,
  })
  const parts = [
    ['原文', out.maskedOriginal, original],
    ['字段值', out.maskedResumeValues, raw],
    ['简历JSON', out.maskedResumeJson, resumeJson],
  ] as const
  for (const [part, masked, source] of parts) {
    if (recoverableDigits(masked).includes(secretDigits)) fail(`${label} ${part} 还能拼出原号码`)
    if (out.restore(masked) !== source) fail(`${label} ${part} 还原后与原文不一致`)
  }
  pass(label)
}

function main(): void {
  const phone = '13800138000'
  const idCard = '110101199003072315'
  const bank = '6222021234567890'
  assertCovered('全角手机号', toFullwidthDigits(phone), phone)
  assertCovered('全角身份证', toFullwidthDigits(idCard), idCard)
  assertCovered('全角银行卡', toFullwidthDigits(bank), bank)

  const studentId = '202301011234'
  assertCovered('全角十二位学号', toFullwidthDigits(studentId), studentId)

  const longDigits = '123456789012345678901234567890'
  const mixed = `${longDigits.slice(0, 10)}０${longDigits.slice(11, 20)}２${longDigits.slice(21)}`
  assertCovered('三十位号码每十位夹一个全角数字', mixed, longDigits)

  assertCovered('三段四段手机号', '138-0013-8000', phone)
  assertCovered('加八六前缀的手机号', '+86 138 0013 8000', '8613800138000')
  assertCovered('六八四身份证', '110101-19900307-2315', idCard)
  assertCovered('四位一组的银行卡', '6222 0212 3456 7890', '6222021234567890')
  assertCovered('三十位号码每十位夹一个空格', '1234567890 1234567890 1234567890', longDigits)
  assertCovered('点分隔的手机号', '138.0013.8000', phone)
  assertCovered('点分隔的银行卡', '6222.0212.3456.7890', '6222021234567890')
  assertCovered('三十位号码每十位夹一个零宽空格', '1234567890\u200B1234567890\u200B1234567890', longDigits)
  assertCovered('三十位号码每十位夹一个零宽连字', '1234567890\u200D1234567890\u200D1234567890', longDigits)
  assertCovered('三十位号码每十位夹一个字节顺序标记', '1234567890\uFEFF1234567890\uFEFF1234567890', longDigits)

  assertUntouched('年月日期轴', '2015.09-2019.06')
  assertUntouched('破折号日期轴', '2020.07—2024.06')

  console.log(`verify:layout-outbound-realistic ${passCount} PASS`)
}

function assertUntouched(label: string, raw: string): void {
  const original = `说明${raw}结束`
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: raw,
    resumeJson: JSON.stringify({ summary: raw }),
    maxOriginalChars: original.length + 800,
  })
  if (!out.maskedOriginal.includes(raw)) fail(`${label} 被收成占位符`)
  if (out.restore(out.maskedOriginal) !== original) fail(`${label} 还原后与原文不一致`)
  pass(label)
}

main()
