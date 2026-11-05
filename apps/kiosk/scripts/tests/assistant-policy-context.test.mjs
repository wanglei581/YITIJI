import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = rel => readFileSync(join(root, rel), 'utf8')
function load(rel, require) {
  const exports = {}
  const code = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: rel,
  }).outputText
  new Function('exports', 'require', code)(exports, require)
  return exports
}

function fixture() {
  const map = new Map()
  const storage = {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  }
  globalThis.sessionStorage = storage
  globalThis.window = { sessionStorage: storage }
  const effects = []
  const states = []
  const react = { useEffect: fn => effects.push(fn), useState: initial => [initial, value => states.push(value)] }
  const draft = load('src/services/assistantDraft.ts', name => {
    assert.equal(name, 'react'); return react
  })
  // 清场用真实实现；打印/扫描等不属于本测试的副作用换成空实现。
  const sensitive = load('src/auth/kioskSensitiveSession.ts', name => name === '../services/assistantDraft'
    ? draft : new Proxy({}, { get: () => () => undefined }))
  const hook = load('src/pages/assistant/AssistantPolicyContext.tsx', name => {
    if (name === 'react') return react
    if (name === '../../services/assistantDraft') return draft
    if (name === '../../auth/kioskSensitiveSession') return sensitive
    if (name === 'react/jsx-runtime') return {}
    throw new Error(`Unexpected dependency ${name}`)
  })
  return { storage, draft, sensitive, hook, effects, states }
}

test('写入政策编号/标题与预填问题；读一次就删', () => {
  const { draft, storage } = fixture()
  draft.rememberAssistantPolicyQuestion({ id: '  policy-1  ', title: '原文标题' })
  assert.deepEqual(draft.takeAssistantPolicyContext(), { policyId: 'policy-1', title: '原文标题' })
  assert.equal(storage.getItem(draft.ASSISTANT_POLICY_KEY), null)
  assert.equal(draft.takeAssistantPolicyContext(), null)
  assert.equal(draft.takeAssistantDraft(), '请用通俗的话讲讲这条政策：《原文标题》')
})

test('空编号不写；坏数据返回 null 并删除；存储拒绝不抛错', () => {
  const { draft, storage } = fixture()
  draft.rememberAssistantPolicyQuestion({ id: ' ', title: '标题' })
  assert.equal(draft.takeAssistantPolicyContext(), null)
  for (const raw of ['{', 'null', '[]', '{}', '{"policyId":2}', '{"policyId":" "}',
    '{"policyId":"p","title":2}', JSON.stringify({ policyId: 'x'.repeat(65), title: '标题' })]) {
    storage.setItem(draft.ASSISTANT_POLICY_KEY, raw)
    assert.equal(draft.takeAssistantPolicyContext(), null, raw)
    assert.equal(storage.getItem(draft.ASSISTANT_POLICY_KEY), null)
  }
  globalThis.sessionStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.doesNotThrow(() => draft.rememberAssistantPolicyQuestion({ id: 'p', title: '标题' }))
  assert.equal(draft.takeAssistantPolicyContext(), null)
})

test('真实清场后政策标记和草稿均读不到', () => {
  const { draft, sensitive } = fixture()
  draft.rememberAssistantPolicyQuestion({ id: 'p', title: '标题' })
  assert.equal(sensitive.hasKioskSensitiveSession(), true)
  sensitive.clearKioskSensitiveSession()
  assert.equal(draft.takeAssistantPolicyContext(), null)
  assert.equal(draft.takeAssistantDraft(), '')
})

test('StrictMode effect 重放不覆盖第一次读取；清场通知同步去掉页内标记', () => {
  const { draft, sensitive, hook, effects, states } = fixture()
  draft.rememberAssistantPolicyQuestion({ id: 'p', title: '标题' })
  const [, clear] = hook.useAssistantPolicyContext()
  assert.equal(effects.length, 1)
  const cleanup = effects[0]()
  cleanup()
  const cleanupAgain = effects[0]()
  assert.deepEqual(states, [{ policyId: 'p', title: '标题' }])
  sensitive.clearKioskSensitiveSession()
  assert.equal(states.at(-1), null)
  clear()
  assert.equal(states.at(-1), null)
  cleanupAgain()
})

test('每轮请求带内存中的编号；取消后清会话；标记可触控且至少 20px', () => {
  const page = read('src/pages/assistant/AssistantPage.tsx')
  const marker = read('src/pages/assistant/AssistantPolicyContext.tsx')
  assert.match(page, /policyId: policyContext\?\.policyId/)
  assert.match(page, /\[aiAvailability, getToken, loading, policyContext, selectedTask, toolboxSkill\]/)
  assert.match(page, /clearPolicyContext\(\); resetConversation\(\)/)
  assert.match(marker, /按《\{context\.title \|\| '这条政策'\}》原文讲解 · 不判断能不能领/)
  assert.match(marker, /minHeight: 64, minWidth: 64, fontSize: 20/)
  assert.match(marker, /不按这条讲了/)
})

test('政策撤下的固定原话真正显示并标为非 AI；mock 示例正文仍不展示', () => {
  const jsx = (type, props) => ({ type: typeof type === 'string' ? type : 'component', props })
  const conversation = load('src/pages/assistant/AdvisorConversation.tsx', name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === './advisorUserCopy') return { advisorDisplayText: text => text }
    return new Proxy({}, { get: () => () => undefined })
  })
  const reply = '这条政策已经撤下或暂时读不到，小青没法按原文讲。可以回到「查政策」看其他政策，或到经办窗口咨询。'
  const fixed = conversation.ChatBubble({ msg: { role: 'assistant', kind: 'not-ai', providerLabel: 'fixed:policy-unavailable', text: reply } })
  assert.ok(JSON.stringify(fixed).includes(reply))
  assert.ok(JSON.stringify(fixed).includes('政策状态提示 · 非 AI 生成'))
  // 固定话术没有替用户保留问题，不能再说「已为你保留问题」。
  assert.ok(!JSON.stringify(fixed).includes('已为你保留问题'))
  const mock = conversation.ChatBubble({ msg: { role: 'assistant', kind: 'not-ai', providerLabel: 'mock', text: '禁止显示的示例正文' } })
  assert.ok(!JSON.stringify(mock).includes('禁止显示的示例正文'))
  assert.ok(JSON.stringify(mock).includes('已为你保留问题'))
})
