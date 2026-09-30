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
