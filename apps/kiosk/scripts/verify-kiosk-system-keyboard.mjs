import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, root), 'utf8')
const code = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const overlay = 'overlays' + 'Content'
const controller = code('src/system-keyboard/controller.ts')
const host = code('src/system-keyboard/SystemKeyboardHost.tsx')
const stage = code('src/hooks/useKioskStageFit.ts')
const dom = code('src/system-keyboard/dom.ts')

// off 必须先返回，不能先获取接口、挂监听或写 overlay；用 AST 检查控制流位置。
const ast = ts.createSourceFile('controller.ts', controller, ts.ScriptTarget.Latest, true)
const start = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'startSystemKeyboard')
assert.ok(start?.body, '必须有可检查的系统键盘启动入口')
const guardIndex = start.body.statements.findIndex((statement) => ts.isIfStatement(statement) && /mode === 'off'/.test(statement.expression.getText(ast)) && /return/.test(statement.thenStatement.getText(ast)))
const beforeGuard = guardIndex < 0 ? controller : start.body.statements.slice(0, guardIndex).map((statement) => statement.getText(ast)).join('\n')
assert.ok(guardIndex >= 0 && !new RegExp(`virtualKeyboard\\(|${overlay}|addEventListener`).test(beforeGuard), 'off 必须先返回，不能访问键盘接口、设置覆盖模式或挂监听')
assert.match(controller, new RegExp(`vk\\.${overlay} = true`), '启用时必须申请覆盖模式')
assert.match(controller, /geometrychange/, '必须监听系统键盘几何事件')
assert.match(stage, /readKeyboardViewport/, '舞台须读取共享键盘视口策略')
assert.match(stage, /addEventListener\(KEYBOARD_VIEWPORT_EVENT, update\)/, '键盘几何变化须触发舞台重算')
assert.match(read('src/layouts/KioskRuntimeRoot.tsx'), /<SystemKeyboardHost\s*\/>/, '运行时根须挂共享层，涵盖独立整屏页')
assert.match(host, /previousPath\.current !== pathname\) dismissSystemKeyboard\(\)/, '路径改变须收键盘')
assert.match(code('src/auth/KioskPrivacyGuard.tsx'), /dismissSystemKeyboard\(\)/, '清场须收键盘')
assert.match(controller, /field\?\.blur\(\)/, '收键盘须让可编辑框失焦')
assert.match(controller, /virtualKeyboard\(\)\?\.hide\(\)/, '收键盘须调用系统 hide')
assert.match(controller, /if \(fluid\(\) \|\| mode === 'shrink'\) return/, '手机不得进入让位逻辑')
assert.match(controller, /if \(pressing\) \{ blurPending = true; return \}[\s\S]*if \(pressing\) \{ blurPending = true; return \}/, '手指按着时，得焦和失焦都不得立刻把页面归位（否则上推时按钮点不中）')
assert.match(read('deploy-env-registry.json'), /VITE_KIOSK_KEYBOARD_AVOID_MODE/, '新环境变量须登记进部署登记表')
assert.ok(JSON.parse(read('package.json')).scripts['test:browser:system-keyboard'], '须注册浏览器用例命令')
assert.ok(readFileSync(new URL('../../.github/workflows/ci.yml', root), 'utf8').includes('test:browser:system-keyboard'), 'CI 须执行浏览器用例')
assert.match(dom, /if \(amount <= 0\) return/, '零上推不能写任何行内样式')
assert.match(dom, /removeProperty\('translate'\)/, '归零必须删除新增位移')
assert.doesNotMatch(dom, /(?:setProperty\(['"]transform|\.transform\s*=)/, '不得覆盖或残留行内 transform')
assert.match(code('src/components/kiosk-shell/KioskStageFit.tsx'), /hostStyle:[^=]*= enabled && needsKeyboardHostHeight\([^\n]*\) \? \{ height: viewportH \} : undefined/, '舞台 host 仅键盘让位时设置高度，归零必须无行内样式')
for (const [file, name] of [['src/auth/KioskPrivacyGuard.tsx', 'ACTIVITY_EVENTS'], ['src/hooks/useIdleTimer.ts', 'ACTIVITY_EVENTS'], ['src/auth/kioskPresence.ts', 'TOUCH_EVENTS']]) {
  const table = code(file).match(new RegExp(`const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`))?.[1] ?? ''
  for (const event of ['input', 'compositionstart', 'compositionupdate', 'compositionend']) assert.ok(table.includes(`'${event}'`), `${file} 的 ${name} 必须包含 ${event}`)
}
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (['node_modules', '.git', 'dist', 'test-results', 'playwright-report'].includes(entry.name)) return []
  const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
  return entry.isDirectory() ? walk(path) : /\.(?:[cm]?[jt]sx?|json|css|yml|html)$/.test(entry.name) ? [path] : []
})
for (const file of walk(new URL('../../', root))) {
  // 浏览器用例要读这个开关来验「启动后接管、off 不接管」，是唯一允许的例外。
  if (file.pathname.includes('/apps/kiosk/src/system-keyboard/') || file.pathname.endsWith('/apps/kiosk/tests/visual/kiosk-system-keyboard.spec.ts')) continue
  assert.ok(!readFileSync(file, 'utf8').includes(overlay), `系统键盘覆盖模式只能由共享目录拥有：${file.pathname}`)
}
for (const file of ['src/vite-env.d.ts', '.env.example']) assert.ok(read(file).includes('VITE_KIOSK_KEYBOARD_AVOID_MODE'), `${file} 须声明配置`)
assert.ok(JSON.parse(read('package.json')).scripts['verify:kiosk-system-keyboard'], '须注册新门禁')
assert.ok(readFileSync(new URL('../../.github/workflows/ci.yml', root), 'utf8').includes('verify:kiosk-system-keyboard'), 'CI 须执行新门禁')
// 文字输入全部走系统键盘：页面自带的文字键盘停放（源码保留），不得再被任何页面或组件引入。
const srcFiles = walk(new URL('src/', root)).filter((file) => /\.tsx?$/.test(file.pathname) && !file.pathname.includes('/src/components/kiosk-keyboard/'))
for (const file of srcFiles) assert.ok(!/from ['"][^'"]*kiosk-keyboard\//.test(readFileSync(file, 'utf8')), `自带文字键盘已停放，不得再引入：${file.pathname}`)
const assistant = code('src/pages/assistant/AssistantPage.tsx')
const composer = assistant.slice(assistant.indexOf('id="assistant-question"'), assistant.indexOf('<div className="assistant-dock-row">'))
assert.ok(composer.length > 0 && !/inputMode="none"/.test(composer), '小青输入框不得再声明 inputMode="none"（那会压住系统键盘）')
const keydown = assistant.slice(assistant.indexOf('const handleKeyDown'), assistant.indexOf('handleSend()', assistant.indexOf('const handleKeyDown')))
assert.ok(/isComposing/.test(keydown) && /compositionEndedAtRef/.test(keydown), '拼音选字时的回车必须先被放过（选字中、以及刚结束选字的那一下），不能当成发送')
assert.match(read('src/pages/print/PrintPickupClaimPage.tsx'), /id="pickup-code-input"[\s\S]{0,900}data-kiosk-keyboard="page"/, '取件码格配着页面数字键盘，须打标记压住系统键盘')
assert.doesNotMatch(read('src/pages/profile/me/components/PhoneRebindPanel.tsx'), /data-kiosk-keyboard="page"/, '换绑三格没有页面数字键盘，靠系统键盘输入，不得打标记（否则无法输入）')
// 输入类型提示：告诉系统键盘该出哪种面板。Chromium 在 Windows 上把 numeric 交给系统的是「只有 0–9」（IS_DIGITS），
// search 会把回车换成「搜索」键（ui/base/ime/win/tsf_input_scope.cc），所以不是配得越多越好。
const literal = (init, source) => {
  if (!init) return true
  const node = ts.isJsxExpression(init) ? init.expression : init
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false
  return node?.getText(source) ?? ''
}
const inputsOf = (url) => {
  const pathname = decodeURIComponent(url.pathname)
  const source = ts.createSourceFile(pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  const visit = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ['input', 'textarea'].includes(node.tagName.getText(source))) {
      const props = node.attributes.properties
      found.push({
        attr: Object.fromEntries(props.filter(ts.isJsxAttribute).map((a) => [a.name.getText(source), literal(a.initializer, source)])),
        spread: props.some(ts.isJsxSpreadAttribute),
        where: `${pathname}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}
// 一、点名：现有的电话、邮箱、纯数字格，逐格核对（按标签上的某个属性找到那一格，必须恰好一格）。
const HINT_FIELDS = [
  ['src/pages/resume/components/ResumeGenerateBasicStep.tsx', 'aria-label', '联系电话', 'tel'],
  ['src/pages/resume/components/ResumeGenerateBasicStep.tsx', 'placeholder', '没有可以空着', 'email'],
  ['src/pages/profile/me/feedback/FeedbackFormPanel.tsx', 'id', 'fb-phone', 'tel'],
  ['src/pages/profile/me/components/PhoneRebindPanel.tsx', 'aria-label', '当前手机号验证码，已隐藏显示', 'numeric'],
  ['src/pages/profile/me/components/PhoneRebindPanel.tsx', 'aria-label', '新手机号', 'numeric'],
  ['src/pages/profile/me/components/PhoneRebindPanel.tsx', 'aria-label', '新手机号验证码，已隐藏显示', 'numeric'],
  ['src/pages/print/CashierPaymentPanel.tsx', 'aria-label', '付款码输入区（内容不显示）', 'numeric'],
  ['src/pages/print/PrintPickupClaimPage.tsx', 'id', 'pickup-code-input', 'numeric'],
]
for (const [file, key, value, mode] of HINT_FIELDS) {
  const hits = inputsOf(new URL(file, root)).filter((field) => field.attr[key] === value)
  assert.equal(hits.length, 1, `${file} 里 ${key}="${value}" 的输入框应恰好一格（改了标签要同步这张表）`)
  assert.equal(hits[0].attr.inputMode, mode, `这一格须 inputMode="${mode}"：${hits[0].where}`)
  assert.ok(!hits[0].spread, `这一格不得用展开属性（会盖掉键盘提示而查不出来）：${hits[0].where}`)
}
// 二、兜底：以后新加的格子，标签上写着电话、邮箱的必须带提示。只认写在标签上的字；云上已关的目录页不管。
const HINT_RULES = [
  [/邮箱|e-?mail/i, ['email'], '邮箱格须 inputMode="email"'],
  [/电话|手机号|phone|mobile/i, ['tel', 'numeric'], '电话格须 inputMode="tel"（只收数字的可用 numeric）'],
]
const HINT_SKIP = /\/src\/(?:pages\/(?:jobs|companies|job-fairs|offline-agencies)\/|components\/qingxu\/directory\/)/
for (const file of srcFiles.filter((f) => f.pathname.endsWith('.tsx') && !HINT_SKIP.test(f.pathname))) {
  for (const { attr, where } of inputsOf(file)) {
    if (['file', 'checkbox', 'radio', 'range', 'hidden'].includes(attr.type) || attr.readOnly === true) continue
    if (attr['data-kiosk-keyboard'] === 'page' || attr.inputMode === 'none') continue
    const what = ['aria-label', 'id', 'name', 'type', 'placeholder'].map((key) => attr[key]).filter((v) => typeof v === 'string').join(' ')
    const rule = HINT_RULES.find(([pattern]) => pattern.test(what))
    if (rule) assert.ok(rule[1].includes(attr.inputMode), `${rule[2]}（这格其实不是填这个的，就改标签上的字）：${where}`)
  }
}
// 三、两格有意不配：页码范围要打短横和逗号，numeric 面板只有 0–9；岗位搜索边打边筛、回车不做事，配 search 会多出一个按了没反应的「搜索」键。
const rangeField = inputsOf(new URL('src/pages/print/PrintPreviewPage.tsx', root)).filter((field) => field.attr['aria-label'] === '自定义页面范围')
assert.ok(rangeField.length === 1 && rangeField[0].attr.inputMode === undefined, '自定义页面范围格不得配 inputMode（数字面板打不出短横、逗号；真触摸屏试过再改这条）')
const searchField = inputsOf(new URL('src/pages/resume/jobFit/JobFitInteractiveViews.tsx', root)).filter((field) => field.attr['aria-label'] === '搜索岗位名称或公司')
assert.ok(searchField.length === 1 && searchField[0].attr.inputMode !== 'search', '岗位搜索格回车不做事，不得配 inputMode="search"')
console.log('PASS Kiosk 系统键盘共享层静态契约')
