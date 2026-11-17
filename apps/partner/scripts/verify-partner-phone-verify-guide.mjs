// 编译并执行真实登录页：判定只看渲染结果，不另写一份「该不该弹」的条件。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let passes = 0
function pass(message) {
  console.log(`PASS ${++passes}. ${message}`)
}

const guideBody = '这个账号是平台代为开通的，暂时不能在这里自己验证手机号。'
const guideNext = '平台登记了你的手机号之后，回到登录页点「忘记密码」，用这个手机号收验证码、设置你自己的密码，验证就完成了。还没有登记，或者收不到验证码的，请联系平台运营，提交盖章的《账号联系人确认函》（写明联系人姓名和手机号）。'
const keptIntro = '，尚未完成本人验证。用户名和密码已登录成功，可以进入工作台。'
const keptFoot = '新账号初始密码由管理员交付。预留手机号尚不能用于短信登录；如需手机登录或找回，请联系管理员核对账号，按确认函联系人登记及本人短信重置流程办理。'
const noCodeHint = '收不到验证码？这个账号可能还没有登记手机号，请联系平台运营。'
const Fragment = Symbol('Fragment')
const jsxRuntime = {
  Fragment,
  jsx: (type, props) => ({ type, props: props ?? {} }),
  jsxs: (type, props) => ({ type, props: props ?? {} }),
}

function harness({ available, phone = '138****0000', verifiedAt = null } = {}) {
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
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }]
    },
    useEffect() {},
    useRef: () => ({ current: null }),
    useCallback: (fn) => fn,
  }
  const globals = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    window: {
      setTimeout: (fn) => {
        fn()
        return 1
      },
      clearTimeout() {},
    },
    TextEncoder: globalThis.TextEncoder,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options })
      assert.ok(replies.length, `unexpected request ${url}`)
      const reply = replies.shift()
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        statusText: '',
        json: async () => reply.body,
      }
    },
  }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    const output = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: file,
    }).outputText
    runInNewContext(output, {
      ...globals,
      exports: module.exports,
      module,
      require: (id) => {
        if (id === 'react') return hooks
        if (id === 'react/jsx-runtime') return jsxRuntime
        if (id === 'react-router-dom') return { useNavigate: () => (...args) => navigations.push(args) }
        if (id === 'lucide-react') return new Proxy({}, { get: () => () => null })
        if (id.endsWith('.css') || id === './LegalDocsModal') return {}
        if (id === '../../services/api/publicBrand') {
          return {
            usePublicBrand: () => ({ brandName: '职易达', brandMark: '职', logoUrl: null }),
            logoPreviewUrl: () => null,
          }
        }
        if (id === '../api/client') return { API_MODE: 'http', API_BASE_URL: '/api/v1' }
        const files = {
          '../../services/auth': 'src/services/auth/index.ts',
          './UnregisteredPhoneNotice': 'src/routes/login/UnregisteredPhoneNotice.tsx',
        }
        assert.ok(files[id], `unexpected import ${id}`)
        return load(files[id])
      },
    }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand)
    if (node == null || typeof node === 'boolean') return []
    if (typeof node !== 'object') return [String(node)]
    if (node.type === Fragment) return expand(node.props?.children)
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return [{ ...node, children: expand(node.props?.children) }]
  }
  function nodes(tree) {
    return tree.flatMap((node) => (typeof node === 'string' ? [] : [node, ...nodes(node.children ?? [])]))
  }
  function text(tree) {
    return tree.map((node) => (typeof node === 'string' ? node : text(node.children ?? []))).join('')
  }
  function flat(tree) {
    return text(tree).replace(/\s+/g, ' ').trim()
  }
  const find = (tree, predicate) => nodes(tree).find(predicate)
  const user = {
    id: 'guide-partner',
    name: '机构账号',
    role: 'partner',
    orgId: 'guide-org',
    phoneVerifiedAt: verifiedAt,
    ...(phone ? { phoneMasked: phone } : {}),
    ...(available === undefined ? {} : { phoneVerificationAvailable: available }),
  }
  const Page = load('src/routes/login/index.tsx').default
  function render() {
    cursor = 0
    return expand(Page())
  }
  return {
    render,
    text,
    flat,
    find,
    requests,
    navigations,
    replies,
    user,
    async login() {
      let tree = render()
      find(tree, (n) => String(n.props.className ?? '').startsWith('c-agree')).props.onClick()
      tree = render()
      replies.push({ status: 200, body: { data: { token: 'fixture-token', user } } })
      await find(tree, (n) => n.type === 'form').props.onSubmit({ preventDefault() {} })
      return render()
    },
  }
}

function dialogOf(h, tree) {
  return h.find(tree, (n) => n.props.role === 'dialog')
}

for (const close of ['进入工作台', '关闭提示并进入工作台']) {
  const h = harness({ available: false, phone: '' })
  const tree = await h.login()
  const dialog = dialogOf(h, tree)
  assert.equal(dialog.props['aria-label'], '账号已登录')
  const shown = h.flat([dialog])
  assert.ok(shown.includes(guideBody), shown)
  assert.ok(shown.includes(guideNext), shown)
  assert.equal(h.text([dialog]).split(guideBody).length - 1, 1)
  assert.equal(h.text([dialog]).split(guideNext).length - 1, 1)
  assert.ok(!shown.includes('undefined'))
  assert.ok(!shown.includes('预留手机号为'))
  assert.ok(!shown.includes(keptFoot))
  assert.ok(!h.find([dialog], (n) => n.type === 'input'))
  assert.ok(!/获取验证码|确认验证/.test(shown))
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].url, '/api/v1/auth/login')
  assert.equal(h.navigations.length, 0)
  h.find(tree, (n) => n.type === 'button' && (h.flat([n]) === close || n.props['aria-label'] === close)).props.onClick()
  assert.equal(JSON.stringify(h.navigations), JSON.stringify([['/', { replace: true }]]))
  pass(`没登记手机号 + false + 未验证：两句定稿逐字一致，无验证码框、无发码；点「${close}」进入工作台`)
}

for (const available of [true, undefined]) {
  const h = harness({ available, phone: '' })
  const tree = await h.login()
  assert.equal(dialogOf(h, tree), undefined)
  assert.equal(h.navigations[0][0], '/')
  assert.ok(!h.text(tree).includes(guideBody))
  pass(`没登记手机号 + ${available === undefined ? '回包没有 phoneVerificationAvailable' : 'true'}：不弹，直接进工作台`)
}

{
  const h = harness({ available: false, phone: '138****0000', verifiedAt: '2026-10-10T00:00:00.000Z' })
  const tree = await h.login()
  assert.equal(dialogOf(h, tree), undefined)
  assert.equal(h.navigations[0][0], '/')
  pass('已验证 + false：不弹，直接进工作台')
}

{
  const h = harness({ available: false, phone: '138****0000' })
  const tree = await h.login()
  const dialog = dialogOf(h, tree)
  assert.equal(dialog.props['aria-label'], '账号已登录')
  const shown = h.flat([dialog])
  assert.ok(shown.includes('账号 机构账号 预留手机号为 138****0000'))
  assert.ok(shown.includes(keptIntro))
  assert.ok(shown.includes(keptFoot))
  assert.ok(!shown.includes(guideBody))
  assert.ok(!shown.includes(guideNext))
  assert.ok(!h.find([dialog], (n) => n.props.id === 'partner-phone-verify-code'))
  assert.equal(h.navigations.length, 0)
  pass('有手机号 + 未验证 + false：仍是 10/24「账号已登录」原文，没有指路两句')
}

{
  const h = harness({ available: true, phone: '138****0000' })
  let tree = await h.login()
  const dialog = dialogOf(h, tree)
  assert.equal(dialog.props['aria-label'], '手机号本人验证')
  assert.ok(h.find([dialog], (n) => n.props.id === 'partner-phone-verify-code'))
  assert.ok(h.flat([dialog]).includes('确认验证'))
  assert.ok(h.flat([dialog]).includes('账号 机构账号 预留手机号为 138****0000'))
  assert.ok(h.flat([dialog]).includes(keptIntro))
  assert.ok(!h.flat([dialog]).includes(keptFoot))
  assert.ok(!h.flat([dialog]).includes(guideBody))
  h.replies.push({ status: 200, body: { data: { sent: true, cooldownSeconds: 60 } } })
  h.find(tree, (n) => n.type === 'button' && h.flat([n]) === '获取验证码').props.onClick()
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  tree = h.render()
  assert.ok(h.flat(tree).includes('60s 后重发'))
  assert.equal(h.requests.at(-1).url, '/api/v1/auth/phone/code')
  pass('有手机号 + 未验证 + true：验证码表单照旧，发码请求仍打到本人验证')
}

{
  const h = harness({ available: false, phone: '' })
  let tree = h.render()
  assert.ok(!h.text(tree).includes(noCodeHint))
  h.find(tree, (n) => String(n.props.className ?? '').startsWith('c-agree')).props.onClick()
  tree = h.render()
  h.find(tree, (n) => n.type === 'button' && h.text([n]).includes('忘记密码')).props.onClick()
  tree = h.render()
  const identity = h.find(tree, (n) => n.props['aria-label'] === '找回密码')
  assert.ok(identity)
  assert.ok(!h.text([identity]).includes(noCodeHint))
  h.find([identity], (n) => n.props.id === 'partner-reset-identity').props.onChange({ target: { value: 'guide-org' } })
  tree = h.render()
  h.replies.push({ status: 200, body: { data: { sent: true, cooldownSeconds: 60 } } })
  const identityAgain = h.find(tree, (n) => n.props['aria-label'] === '找回密码')
  await h.find([identityAgain], (n) => n.type === 'form').props.onSubmit({ preventDefault() {} })
  tree = h.render()
  assert.equal(h.requests.at(-1).url, '/api/v1/auth/password/reset/start')
  assert.equal(h.text(tree).split(noCodeHint).length - 1, 1)
  const codeForm = h.find(tree, (n) => n.type === 'form' && h.find([n], (c) => c.props?.id === 'partner-reset-code'))
  assert.ok(codeForm)
  const hint = h.find([codeForm], (n) => n.props.className === 'c-hint' && h.text([n]).includes(noCodeHint))
  assert.ok(hint)
  assert.equal(h.flat([hint]), noCodeHint)
  const ordered = []
  const walk = (list) => {
    for (const node of list) {
      if (node == null || typeof node !== 'object') continue
      ordered.push(node)
      if (Array.isArray(node.children)) walk(node.children)
    }
  }
  walk(codeForm.children)
  const resendAt = ordered.findIndex((n) => n.type === 'button' && /重新发送验证码|后可重新发送/.test(h.text([n])))
  const hintAt = ordered.findIndex((n) => n === hint)
  assert.ok(resendAt >= 0 && hintAt > resendAt)
  h.find([codeForm], (n) => n.props.id === 'partner-reset-code').props.onChange({ target: { value: '123456' } })
  tree = h.render()
  h.replies.push({ status: 200, body: { data: { resetTicket: 'fixture-reset-ticket' } } })
  const codeAgain = h.find(tree, (n) => n.type === 'form' && h.find([n], (c) => c.props?.id === 'partner-reset-code'))
  await codeAgain.props.onSubmit({ preventDefault() {} })
  tree = h.render()
  assert.ok(h.find(tree, (n) => n.props.id === 'partner-reset-password'))
  assert.ok(!h.text(tree).includes(noCodeHint))
  pass('找回密码只有填码那一步逐字显示收不到验证码的说明，且在重新发送之后')
}

const loginSource = readFileSync(resolve(root, 'src/routes/login/index.tsx'), 'utf8')
const noticeSource = readFileSync(resolve(root, 'src/routes/login/UnregisteredPhoneNotice.tsx'), 'utf8')
assert.equal(loginSource.split(noCodeHint).length - 1, 1)
{
  const codeAt = loginSource.indexOf("resetStep === 'code'")
  const passwordAt = loginSource.indexOf("resetStep === 'password'")
  const hintAt = loginSource.indexOf(noCodeHint)
  assert.ok(codeAt >= 0 && passwordAt > codeAt && hintAt > codeAt && hintAt < passwordAt)
}
assert.equal(noticeSource.split(guideBody).length - 1, 1)
assert.equal(noticeSource.split(guideNext).length - 1, 1)
assert.equal(loginSource.split(guideBody).length - 1, 0)
assert.equal(loginSource.split(keptFoot).length - 1, 1)
assert.ok(loginSource.includes('预留手机号为 {phoneVerifyUser.phoneMasked}'))
assert.ok(loginSource.includes(keptIntro.trim()))
pass('指路两句和找回密码那句各只写在该出现的那一处，10/24 原文仍在登录页')

const css = readFileSync(resolve(root, 'src/routes/login/login.css'), 'utf8')
for (const [, classes] of noticeSource.matchAll(/className="([^"]+)"/g)) {
  for (const name of classes.split(' ')) assert.ok(css.includes(`.${name}`), name)
}
assert.ok(!/style=|#[0-9a-f]{3,8}\b/i.test(noticeSource))
pass('指路弹窗只复用登录页已有样式类')

console.log(`ALL PASS (${passes})`)
