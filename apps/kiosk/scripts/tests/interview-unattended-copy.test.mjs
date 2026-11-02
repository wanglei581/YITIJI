/**
 * 练面试页面级求助句。转译真实源码来跑，不另抄一份句子。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(absolutePath, replacements = {}) {
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('data:'))
  assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const copyUrl = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
// 禁用说法的判定用无人值守词表本体转译出来的 containsStaffHandoff，不在测试里另抄一份词。
const { containsStaffHandoff } = await import(copyUrl)
const mic = await import(transpile(join(kioskRoot, 'src/pages/interview/interviewMicCopy.ts'), {
  '../../copy/unattendedCopy': copyUrl,
}))

const none = { servicePhone: null, serviceHours: null }
const phoneOnly = { servicePhone: '18369161921', serviceHours: null }
const phoneHours = { servicePhone: '18369161921', serviceHours: '工作日 9:00–18:00' }
const contacts = [
  ['有号码有时间', phoneHours, '需要帮助？拨打服务电话 18369161921（工作日 9:00–18:00）'],
  ['只有号码', phoneOnly, '需要帮助？拨打服务电话 18369161921'],
  ['没有', none, null],
]

const sentences = [
  '麦克风权限没有打开：可以直接用文字作答。需要语音时，请在浏览器设置里允许麦克风后点「重新检测麦克风」；在一体机上请联系现场工作人员。',
  '麦克风权限没有打开，请改用文字输入；需要语音时请在浏览器设置里允许麦克风，一体机上请联系现场工作人员',
  'AI 能力尚未启用，请联系现场工作人员',
  '本机设备未就绪，请联系现场工作人员后再试',
]

const occurrences = (text, part) => text.split(part).length - 1

for (const sentence of sentences) {
  for (const [label, contact, phoneLine] of contacts) {
    test(`${label}：${sentence.slice(0, 18)}`, () => {
      const result = mic.interviewUserLine(sentence, contact)
      assert.equal(typeof result, 'string')
      assert.equal(containsStaffHandoff(result), false, `仍含现场求助说法：${result}`)
      assert.equal(result.includes('。。'), false)
      if (phoneLine) {
        // 电话句只出现一次：不能因为替换两次、或原文自带一句而连说两遍。
        assert.equal(occurrences(result, phoneLine), 1, `电话句应恰好出现一次：${result}`)
        assert.equal(occurrences(result, '拨打服务电话'), 1)
      } else {
        assert.equal(result.includes('拨打服务电话'), false)
        assert.equal(result.includes('隐私政策'), false)
      }
    })
  }
}

test('没有求助句时原样返回', () => {
  const plain = '创建练习失败，请稍后重试'
  assert.equal(mic.interviewUserLine(plain, phoneHours), plain)
  assert.equal(mic.interviewMicLine(plain, phoneHours), plain)
  assert.equal(mic.interviewUserLine('', phoneHours), '')
  assert.equal(mic.interviewUserLine(null, none), null)
})
