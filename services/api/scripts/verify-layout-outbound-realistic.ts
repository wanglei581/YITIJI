/**
 * 排版出站按现实写法遮号码。
 *
 * 全角数字先折成半角再检测。分段可以隔空格、制表符、各种短横和点、零宽字符，
 * 也可以用括号包住一段，括号里面可以再夹空格。合计达到 11 位的，按一整串遮。
 * 斜线、全角斜线、换行、回车（含 JSON 里的反斜杠加 n、r、t）把 1 到 8 位的数字段接起来，
 * 合起来不少于 11 位就遮。和通用分隔混用也遮。
 * 简历 JSON 里相邻的数字字段拼起来再遮。括号里的区号单独成字段时也接。
 * 占位符用本次请求才有的标记，用户原文里的形似占位符原样保留。
 * 出站正文去掉这些分隔符、折成半角之后，拼不出原号码。还原与原文逐字一致。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:layout-outbound-realistic
 */
import { maskLayoutAdjustOutbound } from '../src/ai/resume/layout-adjust-mask'
import {
  runDateExemptionCases,
  runExtendedSegmentCases,
  runParenCases,
} from './verify-layout-outbound-realistic-extra'

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

  assertCovered('制表符分段的手机号', '138\t0013\t8000', phone)
  assertCovered('制表符分段的银行卡', '6222\t0212\t3456\t7890', '6222021234567890')
  assertCovered('制表符分段的身份证', '110101\t19900307\t2315', idCard)
  assertCovered('连续空格分段的银行卡', '6222  0212  3456  7890', '6222021234567890')
  assertCovered('空格包住短横的手机号', '138 - 0013 - 8000', phone)
  assertCovered('短破折号分段的手机号', '138\u20130013\u20138000', phone)
  assertCovered('长破折号分段的手机号', '138\u20140013\u20148000', phone)
  assertCovered('连字符分段的手机号', '138\u20100013\u20108000', phone)
  assertCovered('不间断连字符分段的手机号', '138\u20110013\u20118000', phone)
  assertCovered('全角短横分段的手机号', '138\uFF0D0013\uFF0D8000', phone)
  assertCovered('小写短横分段的手机号', '138\uFE630013\uFE638000', phone)
  assertCovered('间隔号分段的手机号', '138\u00B70013\u00B78000', phone)
  assertCovered('圆点分段的手机号', '138\u20220013\u20228000', phone)
  assertCovered('片假名中点分段的手机号', '138\u30FB0013\u30FB8000', phone)
  assertCovered('全角句点分段的手机号', '138\uFF0E0013\uFF0E8000', phone)
  assertCovered('括号包住区号的固话', '(010) 88888888', '01088888888')
  assertCovered('括号包住手机号前三段', '(138) 0013-8000', phone)
  assertCovered('同号两种写法各自还原', '先138-0013-8000再138 0013 8000', phone)
  assertCovered('全角括号包住区号的固话', '（010）88888888', '01088888888')

  assertCovered('斜线分段的手机号', '138/0013/8000', phone)
  assertCovered('斜线分段的固话', '010/88888888', '01088888888')
  assertCovered('斜线分段的身份证', '110101/19900307/2315', idCard)
  assertCovered('斜线分段的银行卡', '6222/0212/3456/7890', '6222021234567890')
  assertCovered('换行分段的手机号', '138\n0013\n8000', phone)
  assertCovered('回车换行分段的银行卡', '6222\r\n0212\r\n3456\r\n7890', '6222021234567890')
  assertCovered('括号内夹空格的固话', '( 010 ) 88888888', '01088888888')
  assertCovered('全角括号内夹空格的手机号', '（ 138 ） 0013-8000', phone)
  assertCovered(
    'JSON 字段里用转义换行分段的手机号',
    '字段说明',
    phone,
    '{"phone":"138\\n0013\\n8000"}',
  )
  assertCovered(
    'JSON 字段里用转义制表符分段的手机号',
    '字段说明',
    phone,
    '{"phone":"138\\t0013\\t8000"}',
  )
  assertCovered(
    'JSON 单字段括号区号',
    '字段说明',
    '01088888888',
    '{"areaCode":"(010)","phoneNumber":"88888888"}',
  )
  assertCovered(
    'JSON 单字段全角括号区号',
    '字段说明',
    '02168888888',
    '{"areaCode":"（021）","phoneNumber":"68888888"}',
  )
  assertCovered(
    'JSON 括号里夹空格的区号',
    '字段说明',
    '01088888888',
    '{"areaCode":"( 010 )","phoneNumber":"88888888"}',
  )
  assertCovered(
    'JSON 括号包住的手机号段',
    '字段说明',
    phone,
    '{"prefix":"(138)","suffix":"00138000"}',
  )

  assertCovered(
    '手机号拆在两个相邻字段',
    '字段说明',
    phone,
    '{"mobilePrefix":"138","mobileBody":"00138000"}',
  )
  assertCovered(
    '银行卡拆在两个相邻字段',
    '字段说明',
    '6222021234567890',
    '{"cardBin":"622202","cardTail":"1234567890"}',
  )
  assertCovered(
    '分段手机号再拆进两个字段',
    '字段说明',
    phone,
    '{"head":"138-0013","tail":"8000"}',
  )
  assertCovered(
    '手机号拆成两个数值字段',
    '字段说明',
    '13888888888',
    '{"mobilePrefix":138,"mobileSuffix":88888888}',
  )
  assertCovered(
    '银行卡拆成两个数值字段',
    '字段说明',
    '6222021234567890',
    '{"cardBin":622202,"cardTail":1234567890}',
  )
  assertCanonicalJsonCovered(
    '数值字段带空格',
    '{"mobilePrefix": 138, "mobileSuffix": 88888888}',
    '13888888888',
  )
  assertCovered(
    '嵌套对象里的数值字段',
    '字段说明',
    '13888888888',
    '{"contact":{"mobilePrefix":138,"mobileSuffix":88888888}}',
  )

  assertUntouched('年月日期轴', '2015.09-2019.06')
  assertUntouched('破折号日期轴', '2020.07—2024.06')
  assertKept('斜线年月区间', '2020/09 - 2024/06')
  assertKept('点与破折号年月区间', '2019.09\u20142023.06')
  assertKept('中文年月区间', '2021年3月-2024年5月')
  assertKept('斜线年月日', '2020/09/01')
  assertKept('钟点时间段', '9:00-18:00')
  assertCovered(
    '转义制表符拆在两个字段',
    '字段说明',
    phone,
    '{"a":"138\\t0013","b":"8000"}',
  )
  assertCovered(
    '转义换行拆在两个字段',
    '字段说明',
    phone,
    '{"a":"138\\n0013","b":"8000"}',
  )
  assertCovered(
    '转义回车拆在两个字段',
    '字段说明',
    phone,
    '{"a":"138\\r0013","b":"8000"}',
  )
  assertJsonKept('纯数字年月不拼', '{"start":"201509","end":"201906"}', '201509')
  assertJsonKept('纯数字年月数值不拼', '{"start":201509,"end":201906}', '201509')
  assertJsonKept('点开的年月不拼', '{"from":"2015.09","to":"2019.06"}', '2015.09')
  assertJsonKept('中间夹了文字就断开', '{"mobilePrefix":"138","note":"备注","mobileBody":"00138000"}', '138')

  runExtendedSegmentCases(assertCovered)
  runDateExemptionCases(assertKept, assertCovered)
  runParenCases({ pass, fail })
  assertPlaceholderCollision()
  assertPrivateUseKept()
  assertTruncationHoleDoesNotCrossWire()

  console.log(`verify:layout-outbound-realistic ${passCount} PASS`)
}

/** 用户原文里已经有形似占位符的字。还原后必须与原文逐字一致，出站拼不出那串长数字。 */
function assertPlaceholderCollision(): void {
  const literal = '[长数字_1]'
  const secret = '9'.repeat(30)
  const original = `${literal}说明${secret}结束`
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: literal,
    resumeJson: JSON.stringify({ summary: literal }),
    maxOriginalChars: original.length + 800,
  })
  if (recoverableDigits(out.maskedOriginal).includes(secret)) fail('形似占位符 原文还能拼出长数字')
  if (!out.maskedOriginal.includes(literal)) fail('形似占位符 用户原文被换掉了')
  if (out.restore(out.maskedOriginal) !== original) fail('形似占位符 还原后与原文不一致')
  if (out.restore(out.maskedResumeValues) !== literal) fail('形似占位符 字段值还原后与原文不一致')
  if (out.restore(literal) !== literal) fail('形似占位符 被当成了真占位符')
  pass('用户原文里的形似占位符原样保留')
}

/** 私用区字符是用户正文，不能当粘连分隔符删掉。 */
function assertPrivateUseKept(): void {
  const phone = '13800138000'
  const raw = `前\uE000后${phone}`
  const original = `说明${raw}结束`
  const json = JSON.stringify({ summary: raw })
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: raw,
    resumeJson: json,
    maxOriginalChars: original.length + 800,
  })
  const parts = [
    ['原文', out.maskedOriginal, original],
    ['字段值', out.maskedResumeValues, raw],
    ['简历JSON', out.maskedResumeJson, json],
  ] as const
  for (const [part, masked, source] of parts) {
    if (!masked.includes('\uE000')) fail(`私用区字符 ${part} 被删掉了`)
    if (recoverableDigits(masked).includes(phone)) fail(`私用区字符 ${part} 还能拼出手机号`)
    if (out.restore(masked) !== source) fail(`私用区字符 ${part} 还原后与原文不一致`)
  }
  pass('私用区字符原样保留')
}

/**
 * 原文里两个长数字，截断丢掉后一个。模型若把空洞补成旧序号，不能还原出被丢掉的号码。
 * 字段值里的第三串完整留下，还原只对上它自己。
 * 出站正文里看不见的序号，按可见标记的 nonce 补出来再还原，也不得带回丢掉的号码。
 * 摘掉 dropAbsentTokens 时，这条会红；只查正文里还在的标记则仍然全绿。
 */
function assertTruncationHoleDoesNotCrossWire(): void {
  const kept = '1'.repeat(11)
  const dropped = '2'.repeat(11)
  const other = '3'.repeat(11)
  const original = `${kept}${'乙'.repeat(40)}${dropped}`
  const json = JSON.stringify({ summary: '说明' })
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: other,
    resumeJson: json,
    maxOriginalChars: 30,
  })
  const restoredOriginal = out.restore(out.maskedOriginal)
  if (!restoredOriginal.includes(kept)) fail('截断空洞 留下来的号码没有还原')
  if (restoredOriginal.includes(dropped)) fail('截断空洞 丢掉的号码又回到原文')
  if (out.restore(out.maskedResumeValues) !== other) fail('截断空洞 另一段号码串到了字段值')
  if (out.restore('[长数字_2]').includes(dropped)) fail('截断空洞 旧序号还原出了丢掉的号码')
  const token = /⦃[0-9a-f]+:\d+⦄/gu
  const seen: Array<{ nonce: string; counter: number; token: string }> = []
  for (const text of [out.maskedOriginal, out.maskedResumeValues, out.maskedResumeJson]) {
    for (const match of text.matchAll(token)) {
      const whole = match[0]
      const parsed = /^⦃([0-9a-f]+):(\d+)⦄$/u.exec(whole)
      if (!parsed || !parsed[1] || !parsed[2]) fail('截断空洞 出站标记认不出来')
      seen.push({ nonce: parsed[1], counter: Number(parsed[2]), token: whole })
      if (out.restore(whole).includes(dropped)) fail('截断空洞 出站标记还能还原出丢掉的号码')
    }
  }
  if (recoverableDigits(out.maskedOriginal).includes(dropped)) fail('截断空洞 出站原文还能拼出丢掉的号码')
  const nonce = seen[0]?.nonce
  if (!nonce || seen.some((item) => item.nonce !== nonce)) fail('截断空洞 出站标记不是同一次请求')
  const counters = new Set(seen.map((item) => item.counter))
  const missing: number[] = []
  for (let counter = Math.min(...counters); counter <= Math.max(...counters); counter += 1) {
    if (!counters.has(counter)) missing.push(counter)
  }
  if (missing.length === 0) fail('截断空洞 出站序号连着，缺号还原钉不住')
  for (const counter of missing) {
    const synthetic = `⦃${nonce}:${counter}⦄`
    if (out.restore(synthetic).includes(dropped)) fail('截断空洞 缺号标记还原出了丢掉的号码')
  }
  pass('截断后占位符不串号')
  pass('截断缺号按可见标记补出来，还原不出丢掉的号码')
}

/**
 * 粘连拆分会把简历 JSON 重新序列化，无意义空白本来就不保留。
 * 这里对重新序列化之后的正文要求：拼不出原号码，还原与那一版逐字一致。
 */
function assertCanonicalJsonCovered(label: string, json: string, secretDigits: string): void {
  const canonical = JSON.stringify(JSON.parse(json))
  const out = maskLayoutAdjustOutbound({
    originalText: '说明结束',
    resumeValues: '说明',
    resumeJson: json,
    maxOriginalChars: 800,
  })
  if (recoverableDigits(out.maskedResumeJson).includes(secretDigits)) fail(`${label} 简历JSON 还能拼出原号码`)
  if (out.restore(out.maskedResumeJson) !== canonical) fail(`${label} 简历JSON 还原后与重新序列化的原文不一致`)
  pass(label)
}

function assertJsonKept(label: string, json: string, visible: string): void {
  const out = maskLayoutAdjustOutbound({
    originalText: '说明结束',
    resumeValues: '说明',
    resumeJson: json,
    maxOriginalChars: 800,
  })
  if (!out.maskedResumeJson.includes(visible)) fail(`${label} 被收成占位符`)
  if (out.restore(out.maskedResumeJson) !== json) fail(`${label} 还原后与原文不一致`)
  pass(label)
}

/** 日期和时间段要原样出现在三段出站正文里，不能换成占位符。 */
function assertKept(label: string, raw: string): void {
  const original = `说明${raw}结束`
  const json = JSON.stringify({ summary: raw })
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: raw,
    resumeJson: json,
    maxOriginalChars: original.length + 800,
  })
  const parts = [
    ['原文', out.maskedOriginal, original],
    ['字段值', out.maskedResumeValues, raw],
    ['简历JSON', out.maskedResumeJson, json],
  ] as const
  for (const [part, masked, source] of parts) {
    if (!masked.includes(raw)) fail(`${label} ${part} 被收成占位符`)
    if (out.restore(masked) !== source) fail(`${label} ${part} 还原后与原文不一致`)
  }
  pass(label)
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
