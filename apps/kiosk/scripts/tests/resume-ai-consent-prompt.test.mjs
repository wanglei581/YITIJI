// 简历 AI 授权 403：登录会员当场重问，游客交给页面原来的失败处理。判断是纯函数。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/pages/resume/resumeAiConsentPrompt.ts'), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'resumeAiConsentPrompt.ts',
}).outputText
const prompt = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

const consentError = (code = 'USER_AI_CONSENT_REQUIRED') => ({ code, status: 403 })

test('登录会员收到简历 AI 授权 403 才当场弹授权', () => {
  assert.equal(prompt.RESUME_AI_CONSENT_REQUIRED_CODE, 'USER_AI_CONSENT_REQUIRED')
  assert.equal(prompt.resumeAiConsentPromptForMember(consentError(), true), true)
  assert.equal(prompt.resumeAiConsentPromptForMember(consentError('AI_DECLARATION_REQUIRED'), true), false)
  assert.equal(prompt.resumeAiConsentPromptForMember(consentError('AI_TASK_NOT_FOUND'), true), false)
  assert.equal(prompt.resumeAiConsentPromptForMember({ status: 403 }, true), false)
  assert.equal(prompt.resumeAiConsentPromptForMember(consentError(''), true), false)
})

test('游客不弹，交给页面原来的失败处理', () => {
  assert.equal(prompt.resumeAiConsentPromptForMember(consentError(), false), false)
  assert.equal(prompt.resumeAiConsentPromptForMember(consentError(), true), true)
})

test('撤回后再收到同一个码，仍然要弹（判断无状态）', () => {
  const again = consentError()
  assert.equal(prompt.resumeAiConsentPromptForMember(again, true), true)
  assert.equal(prompt.resumeAiConsentPromptForMember(again, true), true)
})

test('不是错误对象时不弹', () => {
  for (const error of [null, undefined, 'USER_AI_CONSENT_REQUIRED', 403, { code: 403 }]) {
    assert.equal(prompt.resumeAiConsentPromptForMember(error, true), false)
  }
})

test('不同意时用的那句来自简历诊断页，不另写法律说明', () => {
  const parsePage = readFileSync(join(root, 'src/pages/resume/ResumeParsePage.tsx'), 'utf8')
  const dialog = readFileSync(join(root, 'src/pages/resume/components/ResumeAiConsentDialog.tsx'), 'utf8')
  assert.equal(prompt.RESUME_AI_CONSENT_NEEDED_COPY, '使用简历 AI 前需要先确认授权')
  assert.ok(parsePage.includes(prompt.RESUME_AI_CONSENT_NEEDED_COPY))
  assert.ok(dialog.includes('确认使用简历 AI'))
  assert.ok(dialog.includes('同意并继续'))
})
