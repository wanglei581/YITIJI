import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

function loadMask() {
  const source = ts.transpileModule(
    readFileSync(join(kioskRoot, 'src/utils/maskPii.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText
  const exports = {}
  new Function('exports', 'require', source)(exports, () => {
    throw new Error('maskPii.ts 不应再依赖别的模块')
  })
  return exports
}

const { maskPii, maskPhone, maskEmail, maskIdCard, maskBankCard } = loadMask()

/** 导出前核对框的事实来源（facts.ts 只有类型依赖和同目录相对依赖）。 */
function loadFacts() {
  const cache = new Map()
  const load = (absPath) => {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const output = ts.transpileModule(readFileSync(absPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const loaded = { exports: {} }
    cache.set(absPath, loaded)
    const localRequire = (id) => {
      if (!id.startsWith('.')) throw new Error(`意外依赖 ${id}`)
      return load(join(dirname(absPath), id.endsWith('.ts') ? id : `${id}.ts`))
    }
    new Function('exports', 'module', 'require', output)(loaded.exports, loaded, localRequire)
    return loaded.exports
  }
  return load(join(kioskRoot, 'src/pages/resume/components/resume-deliver/facts.ts'))
}

const ID18 = '370200199001011234'
const ID18X = '11010119900307867X'
const ID15 = '110101900307123'
const PHONE = '13800000741'
const EMAIL = 'zhouqing@example.com'
const BANK16 = '6222021234567890'
const BANK19 = '6222021234567890123'

test('手机号与邮箱打码保持原有样子', () => {
  assert.equal(maskPhone('13812345678'), '138****5678')
  assert.equal(maskEmail('user@example.com'), 'u***@example.com')
  assert.equal(maskPii(`电话 13812345678，邮箱 user@example.com`), '电话 138****5678，邮箱 u***@example.com')
})

test('五类个人信息在一段话里都打码，原文不留在屏上', () => {
  const raw = `证件 ${ID18}，旧证 ${ID15}，大写 ${ID18X}，电话 ${PHONE}，邮箱 ${EMAIL}，卡 ${BANK16}，长卡 ${BANK19}`
  const masked = maskPii(raw)
  for (const secret of [ID18, ID15, ID18X, ID18X.toLowerCase(), PHONE, EMAIL, BANK16, BANK19]) {
    assert.equal(masked.includes(secret), false, secret)
  }
  assert.match(masked, /370200\*{8}1234/)
  assert.match(masked, /110101\*{5}7123/)
  assert.match(masked, /110101\*{8}867X/)
  assert.match(masked, /138\*{4}0741/)
  assert.match(masked, /z\*{3}@example\.com/)
  assert.match(masked, /6222\*{8}7890/)
  assert.match(masked, /6222\*{11}0123/)
})

test('单独一段证件号和银行卡号也能打码', () => {
  assert.equal(maskIdCard(ID18), '370200********1234')
  assert.equal(maskIdCard(ID18X.toLowerCase()), '110101********867X')
  assert.equal(maskIdCard(ID15), '110101*****7123')
  assert.equal(maskBankCard(BANK16), '6222********7890')
  assert.equal(maskBankCard(BANK19), '6222***********0123')
})

test('18 位证件号不会被当成银行卡留下中间数字', () => {
  const masked = maskPii(ID18)
  assert.equal(masked.includes('19900101'), false)
  assert.equal(masked, '370200********1234')
})

test('带空格、横线或 +86 前缀的大陆手机号，归一后一律显示成 138****5678', () => {
  for (const raw of [
    '138 1234 5678',
    '138-1234-5678',
    '+86 13812345678',
    '+8613812345678',
    '+86 138 1234 5678',
    '+86-138-1234-5678',
    '（+86）138 1234 5678',
    '138\u30001234\u30005678',
    '138\uFF0D1234\uFF0D5678',
    '138 12345678',
  ]) {
    assert.equal(maskPii(raw), '138****5678', raw)
  }
  assert.equal(maskPii('电话：+86 138-1234-5678（微信同号）'), '电话：138****5678（微信同号）')
  assert.equal(maskPii('(+86 138 1234 5678)'), '(138****5678)')
})

test('普通 11 位手机号照旧打码', () => {
  assert.equal(maskPii('13812345678'), '138****5678')
  assert.equal(maskPii('2019 年起 13812345678 可联系'), '2019 年起 138****5678 可联系')
})

test('座机号不按手机号打码', () => {
  for (const raw of ['010-12345678', '0755-8888 1234', '021 6123 4567', '+86 10 8888 6666']) {
    assert.equal(maskPii(raw), raw, raw)
  }
})

test('年份区间、金额等不是手机号的数字串不打码', () => {
  for (const raw of [
    '2019-2023',
    '2015.09 - 2019.06',
    '1998-2002 120 人',
    '月薪 15000-20000 元',
    '销售额 1380 万',
    '138 1234 56789',
    '138123456789',
    '135\n2019\n2023',
  ]) {
    assert.equal(maskPii(raw), raw, raw)
  }
})

test('导出前核对框：简历里带分隔或 +86 的电话显示成 138****5678，时间段原样', () => {
  const { extractConfirmableFacts } = loadFacts()
  for (const phone of ['138 1234 5678', '138-1234-5678', '+86 13812345678']) {
    const facts = extractConfirmableFacts({
      basic: { name: '周晴', phone, email: 'zhouqing@example.com', city: '青岛' },
      intention: { position: '行政专员', city: '青岛' },
      summary: '',
      education: [{ school: '青岛大学', major: '行政管理', degree: '本科', period: '2015.09 - 2019.06' }],
      experience: [{ company: '青岛海纳物业服务有限公司', role: '行政助理', period: '2019.07 - 2023.12' }],
      projects: [],
      skills: [],
      certificates: [],
    })
    const shown = Object.fromEntries(facts.map((fact) => [fact.id, maskPii(fact.value)]))
    assert.equal(shown.phone, '138****5678', phone)
    assert.equal(shown['edu-period-0'], '2015.09 - 2019.06')
    assert.equal(shown['exp-period-0'], '2019.07 - 2023.12')
  }
})
