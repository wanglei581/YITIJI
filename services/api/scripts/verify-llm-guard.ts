import assert from 'node:assert/strict'
import {
  DEFAULT_FORBIDDEN_WORDS,
  buildGuardedSystemPrompt,
  containsForbiddenWord,
  enforceForbiddenWords,
} from '../src/ai/llm/llm-guard'

const roleScope = '只能提供简历、打印扫描、政策信息、岗位和招聘会来源入口相关建议。'
const forbiddenWords = [...DEFAULT_FORBIDDEN_WORDS, '内部承诺']

const prompt = buildGuardedSystemPrompt({
  systemPrompt: '你是就业服务助手。',
  roleScope,
  forbiddenWords,
})

assert.ok(prompt.includes(roleScope), 'role scope should be included in the guarded prompt')
assert.ok(prompt.includes('不得输出管理员配置的禁用词'), 'guard prompt should include forbidden-word instruction')
assert.equal(containsForbiddenWord(`请给我${['一键', '投递'].join('')}方案`, DEFAULT_FORBIDDEN_WORDS), true)
assert.equal(containsForbiddenWord('这里只是简历修改建议', DEFAULT_FORBIDDEN_WORDS), false)

const blocked = enforceForbiddenWords('可以内部承诺后续流程。', forbiddenWords)
assert.notEqual(blocked, '可以内部承诺后续流程。')
assert.equal(containsForbiddenWord(blocked, forbiddenWords), false)

const allowed = enforceForbiddenWords('建议先完善简历重点项目经历。', forbiddenWords)
assert.equal(allowed, '建议先完善简历重点项目经历。')

console.log('verify:llm-guard passed')
