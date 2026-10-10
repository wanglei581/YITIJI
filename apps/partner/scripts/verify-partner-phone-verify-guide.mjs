// 在 VM 中执行真实登录页和 auth adapter；不依赖端口、浏览器或真实短信。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
let passes = 0
function pass(message) { console.log(`PASS ${++passes}. ${message}`) }
const guideCopy = [
  '这个账号是平台代为开通的，还没有登记使用人的手机号，暂时不能在这里自己验证。',
  '请联系平台运营，提交盖章的《账号联系人确认函》（写明联系人姓名和手机号），由平台登记这个手机号。登记后回到登录页点「忘记密码」，用这个手机号收验证码、设置你自己的密码，验证就完成了。',
  '在这之前，仍可用账号和密码登录、正常使用后台；手机号登录和自助找回密码暂时用不了。',
]

function harness(ready, phone = '138****0000', verifiedAt = null) {
  const storage = new Map()
  const states = []
  const requests = []
  const navigations = []
  const replies = []
  let cursor = 0
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useEffect() {}, useRef: () => ({ current: null }), useCallback: (fn) => fn,
  }
  const globals = {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    window: { setTimeout: (fn) => { fn(); return 1 }, clearTimeout() {} },
    fetch: async (url, options) => {
      requests.push({ url, options })
      assert.ok(replies.length, `unexpected request ${url}`)
      const reply = replies.shift()
      return { ok: reply.status === 200, status: reply.status, json: async () => reply.body }
    },
  }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}
    const output = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: file,
    }).outputText
    runInNewContext(output, { ...globals, exports, require: (id) => {
      if (id === 'react') return hooks
      if (id === 'react/jsx-runtime') return require(id)
      if (id === 'react-router-dom') return { useNavigate: () => (...args) => navigations.push(args) }
      if (id === 'lucide-react') return new Proxy({}, { get: () => () => null })
      if (id.endsWith('.css') || id === './LegalDocsModal') return {}
      if (id === '../api/client') return { API_MODE: 'http', API_BASE_URL: '/api/v1' }
      const files = {
        '../../services/auth': 'src/services/auth/index.ts',
        './PhoneVerificationGuide': 'src/routes/login/PhoneVerificationGuide.tsx',
        '../../services/api/userErrorMessage': 'src/services/api/userErrorMessage.ts',
      }
      assert.ok(files[id], `unexpected import ${id}`)
      return load(files[id])
    } }, { filename: file })
    cache.set(file, exports)
    return exports
  }
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand)
    if (node == null || typeof node === 'boolean') return []
    if (typeof node !== 'object') return [String(node)]
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return [{ ...node, children: expand(node.props.children) }]
  }
  const Page = load('src/routes/login/index.tsx').default
  function render() { cursor = 0; return expand(Page()) }
  function nodes(tree) { return tree.flatMap((node) => typeof node === 'string' ? [] : [node, ...nodes(node.children)]) }
  function text(tree) { return tree.map((node) => typeof node === 'string' ? node : text(node.children)).join('') }
  const find = (tree, predicate) => nodes(tree).find(predicate)
  const user = { id: 'guide-partner', name: '机构账号', role: 'partner', orgId: 'guide-org', phoneMasked: phone, phoneVerifiedAt: verifiedAt, ...(ready === undefined ? {} : { phoneSelfVerifyReady: ready }) }
  const auth = load('src/services/auth/index.ts')
  return { render, nodes, text, find, auth, requests, navigations, replies, user,
    async login() {
      let tree = render()
      find(tree, (n) => n.props.className?.startsWith('c-agree')).props.onClick()
      tree = render()
      replies.push({ status: 200, body: { data: { token: 'fixture-token', user } } })
      await find(tree, (n) => n.type === 'form').props.onSubmit({ preventDefault() {} })
      return render()
    },
  }
}

function assertGuide(h, tree) {
  const dialog = h.find(tree, (n) => n.props.role === 'dialog')
  assert.equal(dialog.props['aria-label'], '手机号本人验证')
  for (const copy of guideCopy) assert.ok(h.text([dialog]).includes(copy))
  assert.ok(!/工作人员|线下核验恢复|1\d{10}/.test(h.text([dialog])))
  assert.ok(!h.find([dialog], (n) => n.type === 'input' || n.type === 'form'))
  assert.ok(!/获取验证码|确认验证/.test(h.text([dialog])))
  assert.ok(h.find([dialog], (n) => n.type === 'button' && h.text([n]) === '知道了，进入工作台'))
}

for (const close of ['知道了，进入工作台', '稍后验证']) {
  const h = harness(false)
  const tree = await h.login()
  assertGuide(h, tree)
  assert.equal(h.requests.length, 1)
  h.find(tree, (n) => n.type === 'button' && (h.text([n]) === close || n.props['aria-label'] === close)).props.onClick()
  assert.equal(JSON.stringify(h.navigations), JSON.stringify([['/', { replace: true }]]))
  pass(`false 显示逐字指路、无验证控件或额外请求；${close}进入工作台`)
}
for (const ready of [true, undefined]) {
  const h = harness(ready)
  let tree = await h.login()
  assert.ok(h.find(tree, (n) => n.props.id === 'partner-phone-verify-code'))
  assert.ok(h.text(tree).includes('确认验证'))
  assert.ok(!h.text(tree).includes(guideCopy[0]))
  h.replies.push({ status: 200, body: { data: { sent: true, cooldownSeconds: 60 } } })
  h.find(tree, (n) => n.type === 'button' && h.text([n]) === '获取验证码').props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  tree = h.render()
  assert.ok(h.text(tree).includes('60s 后重发'))
  assert.equal(h.requests.at(-1).url, '/api/v1/auth/phone/code')
  pass(`${ready} 保留原输入、确认和成功发码倒计时`)
}
for (const code of ['ACCOUNT_PASSWORD_PROOF_NOT_READY', 'SMS_TOO_FREQUENT']) {
  const h = harness(undefined)
  let tree = await h.login()
  h.replies.push({ status: 409, body: { error: { code, message: '请稍后重试' } } })
  h.find(tree, (n) => n.type === 'button' && h.text([n]) === '获取验证码').props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  tree = h.render()
  if (code === 'ACCOUNT_PASSWORD_PROOF_NOT_READY') assertGuide(h, tree)
  else {
    assert.ok(h.find(tree, (n) => n.props.id === 'partner-phone-verify-code'))
    assert.ok(h.text(tree).includes('请稍后重试'))
    assert.ok(!h.text(tree).includes(guideCopy[0]))
  }
  pass(`${code} 仅持有人证明错误切换指路，其他错误保留正常版`)
}
for (const [phone, verifiedAt] of [[undefined, null], ['138****0000', '2026-10-10T00:00:00Z']]) {
  const h = harness(false, phone ?? '', verifiedAt)
  const tree = await h.login()
  assert.ok(!h.find(tree, (n) => n.props.role === 'dialog'))
  assert.equal(h.navigations[0][0], '/')
  pass('无手机号或已经验证时保持直接进入工作台')
}
const h = harness(true)
await h.login()
for (const ready of [false, true, undefined]) {
  h.replies.push({ status: 200, body: { data: { userId: h.user.id, role: 'partner', orgId: h.user.orgId, ...(ready === undefined ? {} : { phoneSelfVerifyReady: ready }) } } })
  const user = await h.auth.verifyToken()
  assert.equal(user.phoneSelfVerifyReady, ready)
  assert.equal(h.auth.getUser().phoneSelfVerifyReady, ready)
  assert.equal(h.requests.at(-1).url, '/api/v1/auth/me')
  pass(`/auth/me 的 ${ready} 值合并进本地，缺失时不沿用旧值`)
}
const css = readFileSync(resolve(root, 'src/routes/login/login.css'), 'utf8')
const guide = readFileSync(resolve(root, 'src/routes/login/PhoneVerificationGuide.tsx'), 'utf8')
for (const [, classes] of guide.matchAll(/className="([^"]+)"/g)) {
  for (const name of classes.split(' ')) assert.ok(css.includes(`.${name}`))
}
assert.ok(!/style=|#[0-9a-f]{3,8}\b/i.test(guide))
pass('指路版仅复用现有样式类，无新颜色')
console.log(`ALL PASS (${passes})`)
