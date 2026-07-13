import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const resolve = (relativePath) => join(appRoot, relativePath)

let failures = 0

function fail(message) {
  failures += 1
  console.error(`[K1_PUBLIC_ENTRY_VERIFY_FAILED] ${message}`)
}

function expect(condition, message) {
  if (!condition) fail(message)
}

function read(relativePath) {
  const absolutePath = resolve(relativePath)
  if (!existsSync(absolutePath)) {
    fail(`${relativePath}: 文件不存在`)
    return ''
  }

  try {
    return readFileSync(absolutePath, 'utf8')
  } catch (error) {
    fail(`${relativePath}: 无法读取（${error instanceof Error ? error.message : String(error)}）`)
    return ''
  }
}

function lineCount(source) {
  return source.length === 0 ? 0 : source.split(/\r?\n/).length
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function expectIncludes(source, marker, label) {
  expect(source.includes(marker), `${label}: 缺少 ${marker}`)
}

function expectNotIncludes(source, marker, label) {
  expect(!source.includes(marker), `${label}: 禁止包含 ${marker}`)
}

function expectPattern(source, pattern, label) {
  expect(pattern.test(source), `${label}: 未匹配 ${pattern}`)
}

function balancedBlock(source, openIndex, openCharacter, closeCharacter) {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === openCharacter) depth += 1
    if (source[index] === closeCharacter) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, index + 1)
    }
  }
  return ''
}

function componentBody(source, componentName) {
  const declaration = new RegExp(`export\\s+function\\s+${escapeRegExp(componentName)}\\b`)
  const match = declaration.exec(source)
  if (!match || match.index === undefined) return ''

  const parametersStart = source.indexOf('(', match.index)
  const parameters = balancedBlock(source, parametersStart, '(', ')')
  if (!parameters) return ''

  const bodyStart = source.indexOf('{', parametersStart + parameters.length)
  const body = balancedBlock(source, bodyStart, '{', '}')
  return body ? body.slice(1, -1) : ''
}

function componentRenderRoot(source, componentName) {
  const body = componentBody(source, componentName)
  if (!body) return ''

  let depth = 0
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === '{') depth += 1
    if (body[index] === '}') depth -= 1
    if (depth !== 0 || !body.startsWith('return', index)) continue
    if (/[$\w]/.test(body[index - 1] ?? '') || /[$\w]/.test(body[index + 6] ?? '')) continue

    const afterReturn = body.slice(index + 'return'.length)
    const root = afterReturn.match(/^\s*\(\s*<(?:div|main|section)\b([\s\S]*?)>/)
    if (root) return root[0]
  }
  return ''
}

function expectPageRootClasses(source, componentName, rootClass, label) {
  const root = componentRenderRoot(source, componentName)
  const rootMatch = root.match(/className\s*=\s*(["'])([^"']*)\1/)
  expect(rootMatch !== null, `${label}: 未找到 ${componentName} 实际 render 根节点的静态 div/main/section className`)
  if (!rootMatch) return root

  const classes = rootMatch[2].split(/\s+/)
  expect(classes.includes('service-desk'), `${label}: 顶层 UI 缺少 service-desk class`)
  expect(classes.includes(rootClass), `${label}: 顶层 UI 缺少 ${rootClass} root class`)
  return root
}

function expectStandaloneServiceDeskAttributes(root, label) {
  const requiredAttributes = [
    ['data-visual-theme', 'service-desk'],
    ['data-ux-density', 'touch'],
  ]
  const missing = requiredAttributes
    .filter(([attribute, value]) => !new RegExp(`\\b${escapeRegExp(attribute)}\\s*=\\s*(['"])${escapeRegExp(value)}\\1`).test(root))
    .map(([attribute, value]) => `${attribute}=${value}`)
  expect(missing.length === 0, `${label}: 实际 render 根节点缺少 ${missing.join('、')}`)
}

function routePathEntries(source) {
  return [...source.matchAll(/\bpath\s*:\s*(['"`])([^'"`]+)\1/g)].map((match) => ({
    index: match.index ?? -1,
    value: match[2],
  }))
}

function kioskRootChildrenRange(source) {
  const rootRoute = /\{\s*path\s*:\s*(['"`])\/\1\s*,\s*element\s*:\s*<KioskRoot\b[\s\S]{0,240}?\bchildren\s*:/m.exec(source)
  if (!rootRoute || rootRoute.index === undefined) return null

  const childrenStart = source.indexOf('[', rootRoute.index + rootRoute[0].length)
  const children = balancedBlock(source, childrenStart, '[', ']')
  if (!children) return null

  return { start: childrenStart, end: childrenStart + children.length }
}

function expectCssContract(path, scopeClass, { reducedMotion = true } = {}) {
  const source = read(path)
  const lines = lineCount(source)
  expect(source.length > 0, `${path}: CSS 不能为空`)
  expect(lines > 0 && lines < 300, `${path}: 必须少于 300 行（当前 ${lines}）`)
  expectPattern(
    source,
    new RegExp(`\\.${escapeRegExp(scopeClass)}(?:[\\s.{:#\\[]|$)`),
    `${path}: 缺少 ${scopeClass} 范围选择器`,
  )
  const scopeViolations = cssScopeViolations(source, scopeClass)
  expect(
    scopeViolations.length === 0,
    `${path}: selector 必须以 .${scopeClass} root class 开始，禁止全局或其它页面 scope（发现：${scopeViolations.join('、')}）`,
  )
  if (reducedMotion) {
    expectPattern(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, `${path}: 缺少 prefers-reduced-motion`)
  }
  return source
}

function stripCssComments(source) {
  let result = ''
  let quote = ''

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      result += character
      if (character === '\\') {
        result += source[index + 1] ?? ''
        index += 1
      } else if (character === quote) {
        quote = ''
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      result += character
      continue
    }

    if (character === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      if (commentEnd === -1) return result
      result += source.slice(index, commentEnd + 2).replace(/[^\r\n]/g, ' ')
      index = commentEnd + 1
      continue
    }

    result += character
  }

  return result
}

function cssBlockEnd(source, openIndex) {
  let depth = 0
  let quote = ''

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = ''
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function cssHeaderEnd(source, start) {
  let quote = ''
  let parentheses = 0
  let brackets = 0

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = ''
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '(') {
      parentheses += 1
    } else if (character === ')') {
      parentheses -= 1
    } else if (character === '[') {
      brackets += 1
    } else if (character === ']') {
      brackets -= 1
    } else if (parentheses === 0 && brackets === 0 && (character === '{' || character === ';')) {
      return index
    }
  }

  return -1
}

function splitCssSelectorList(header) {
  const selectors = []
  let start = 0
  let quote = ''
  let parentheses = 0
  let brackets = 0

  for (let index = 0; index < header.length; index += 1) {
    const character = header[index]
    if (quote) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = ''
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '(') {
      parentheses += 1
    } else if (character === ')') {
      parentheses -= 1
    } else if (character === '[') {
      brackets += 1
    } else if (character === ']') {
      brackets -= 1
    } else if (character === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(header.slice(start, index).trim())
      start = index + 1
    }
  }

  selectors.push(header.slice(start).trim())
  return selectors.filter(Boolean)
}

function cssSelectorHeaders(source) {
  const selectors = []
  const errors = []
  const css = stripCssComments(source)

  function walk(block) {
    let index = 0
    while (index < block.length) {
      while (/\s|;/.test(block[index] ?? '')) index += 1
      if (index >= block.length) return

      const headerEnd = cssHeaderEnd(block, index)
      if (headerEnd === -1) {
        errors.push('无法定位 CSS rule 边界')
        return
      }

      const header = block.slice(index, headerEnd).trim()
      if (block[headerEnd] === ';') {
        index = headerEnd + 1
        continue
      }

      const blockEnd = cssBlockEnd(block, headerEnd)
      if (blockEnd === -1) {
        errors.push(`未闭合 CSS block: ${header}`)
        return
      }

      const body = block.slice(headerEnd + 1, blockEnd)
      if (/^@(?:-[\\w]+-)?keyframes\b/i.test(header)) {
        index = blockEnd + 1
        continue
      }
      if (header.startsWith('@')) {
        walk(body)
      } else if (header) {
        selectors.push(...splitCssSelectorList(header))
      }
      index = blockEnd + 1
    }
  }

  walk(css)
  return { selectors, errors }
}

function cssScopeViolations(source, scopeClass) {
  const { selectors, errors } = cssSelectorHeaders(source)
  const rootSelector = new RegExp(`^\\.${escapeRegExp(scopeClass)}(?=$|[\\s>+~.:#\\[])`)
  return [
    ...errors.map((error) => `CSS 解析失败: ${error}`),
    ...selectors.filter((selector) => !rootSelector.test(selector)),
  ]
}

function expectCssScopeSelfCheck() {
  const scopeClass = 'k1-css-scope-test'
  const forbiddenSelectors = [
    ['html { color: red; }', 'html'],
    ['body { color: red; }', 'body'],
    [':root { color: red; }', ':root'],
    ['* { color: red; }', '*'],
    ['.ui-kiosk-shell { color: red; }', '.ui-kiosk-shell'],
    ['.k1-other-page { color: red; }', '.k1-other-page'],
    ['@media (max-width: 480px) { .ui-kiosk-shell { color: red; } }', '.ui-kiosk-shell'],
  ]

  for (const [source, selector] of forbiddenSelectors) {
    expect(
      cssScopeViolations(source, scopeClass).includes(selector),
      `CSS scope self-check 必须拒绝逃逸 selector: ${selector}`,
    )
  }

  const allowedSource = `
    .${scopeClass} { color: green; }
    .${scopeClass} *::before { box-sizing: border-box; }
    @media (prefers-reduced-motion: reduce) {
      .${scopeClass} *, .${scopeClass} *::after { animation: none; }
    }
    @keyframes k1-css-scope-test-pulse {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `
  expect(
    cssScopeViolations(allowedSource, scopeClass).length === 0,
    'CSS scope self-check 必须允许对应 K1 root、其通配后代与 reduced motion selector',
  )
}

console.log('=== LightFlow K1 Kiosk 公共入口静态合同 ===')

expectCssScopeSelfCheck()

const packageJson = read('package.json')
const routes = read('src/routes/index.tsx')
const kioskRoot = read('src/layouts/KioskRoot.tsx')
const loginPage = read('src/pages/auth/LoginPage.tsx')
const memberPhoneLoginHook = read('src/pages/auth/hooks/useMemberPhoneLogin.ts')
const memberPhoneLoginPane = read('src/pages/auth/components/MemberPhoneLoginPane.tsx')
const memberAgreement = read('src/pages/auth/components/MemberAgreement.tsx')
const mobileQrPage = read('src/pages/auth/MobileQrLoginPage.tsx')
const scanQrPanel = read('src/pages/auth/ScanQrLoginPanel.tsx')
const phoneUploadPage = read('src/pages/upload/PhoneUploadPage.tsx')
const legalDocPage = read('src/pages/legal/LegalDocPage.tsx')
const screensaverPage = read('src/pages/screensaver/ScreensaverPage.tsx')
const helpCenterPage = read('src/pages/help/HelpCenterPage.tsx')

expectIncludes(
  packageJson,
  '"verify:lightflow-k1-public-entry": "node scripts/verify-lightflow-k1-public-entry.mjs"',
  'package.json',
)

for (const [path, component] of [
  ['/login', 'LoginPage'],
  ['/member/qr-login', 'MobileQrLoginPage'],
  ['/upload/phone', 'PhoneUploadPage'],
  ['/legal/:doc', 'LegalDocPage'],
  ['/screensaver', 'ScreensaverPage'],
]) {
  expectPattern(
    routes,
    new RegExp(`\\{\\s*path:\\s*'${escapeRegExp(path)}'\\s*,\\s*element:\\s*<${component}\\s*/>\\s*\\}`),
    `${path} 必须保留精确顶级路由`,
  )
}

expectPattern(
  routes,
  /\{\s*path\s*:\s*(['"`])\/\1\s*,\s*element\s*:\s*<KioskRoot\s*\/>\s*,\s*children\s*:\s*\[[\s\S]*?\{\s*path\s*:\s*(['"`])help\2\s*,\s*element\s*:\s*<HelpCenterPage\s*\/>\s*\}/,
  '/help 必须有唯一 KioskRoot nested 精确路由',
)
const childrenRange = kioskRootChildrenRange(routes)
expect(childrenRange !== null, 'routes 必须能定位 KioskRoot children 区间')
const helpRouteEntries = routePathEntries(routes).filter(({ value }) => value === 'help' || value.startsWith('help/') || value === '/help' || value.startsWith('/help/'))
const nestedHelpEntries = helpRouteEntries.filter(({ index }) => childrenRange && index > childrenRange.start && index < childrenRange.end)
const externalHelpEntries = helpRouteEntries.filter(({ index }) => !childrenRange || index <= childrenRange.start || index >= childrenRange.end)
expect(nestedHelpEntries.length === 1 && nestedHelpEntries[0].value === 'help', '/help 只能有一个 nested path: help 精确入口')
expect(externalHelpEntries.length === 0, 'routes 不得添加顶级 /help、/help/* 或 /help/:param 入口')

expectIncludes(
  kioskRoot,
  "const isServiceDeskRoute = pathname === '/' || pathname === '/help'",
  'KioskRoot',
)
expectPattern(
  kioskRoot,
  /visualTheme=\{isServiceDeskRoute\s*\?\s*'service-desk'\s*:\s*'legacy'\}/,
  'KioskRoot visualTheme 必须只由 isServiceDeskRoute 切换',
)
expect((kioskRoot.match(/service-desk/g) ?? []).length === 1, 'KioskRoot 只能有一个 service-desk opt-in')

for (const [source, marker, label] of [
  [memberPhoneLoginHook, 'memberLogin(phone, code, deviceId)', '共享手机号控制器真实登录'],
  [memberPhoneLoginHook, 'sendSmsCode(phone, deviceId)', '共享手机号控制器真实发送验证码'],
  [memberPhoneLoginHook, 'getMemberAuthDeviceId()', '共享手机号控制器使用稳定 deviceId'],
  [loginPage, 'clearKioskSensitiveSession(', 'LoginPage 公共终端清会话'],
  [scanQrPanel, 'claimingRef.current = true', 'ScanQrLoginPanel 防重复认领'],
  [mobileQrPage, 'fetchQrLoginStatus(', 'MobileQrLoginPage 查询二维码状态'],
  [mobileQrPage, 'confirmQrLogin(', 'MobileQrLoginPage 确认二维码登录'],
  [screensaverPage, 'clearKioskSensitiveSession(', 'ScreensaverPage 公共终端清会话'],
  [screensaverPage, 'getScreensaverPlaylist(', 'ScreensaverPage 获取真实屏保素材'],
  [legalDocPage, 'navigate(-1)', 'LegalDocPage 返回上一页'],
]) {
  expectIncludes(source, marker, label)
}
expectPattern(loginPage, /isSafeInternalPath\s*\(\s*(?:queryFrom|fromState)\s*\)/, 'LoginPage returnTo 安全校验必须实际调用 isSafeInternalPath')
expectIncludes(loginPage, 'useMemberPhoneLogin({', 'LoginPage 必须消费共享手机号控制器')
expectIncludes(loginPage, '<MemberPhoneLoginPane {...phoneLogin.paneProps} />', 'LoginPage 必须挂载共享手机号面板')
expectIncludes(loginPage, '<MemberAgreement agreed={agreed}', 'LoginPage 必须挂载共享协议组件')
expectPattern(
  phoneUploadPage,
  /uploadPhoneSessionFile\s*\(\s*\{\s*sessionId\s*,\s*uploadToken\s*,\s*file\s*,?\s*\}\s*\)/,
  'PhoneUploadPage 必须以当前 sessionId 调用 uploadPhoneSessionFile',
)

expectIncludes(memberAgreement, 'className="k-agree-check"', '共享协议组件勾选必须是独立交互控件')
expectIncludes(memberPhoneLoginPane, 'className="k-input-target"', '共享手机号面板输入触发区必须与发送验证码按钮并列')
expectNotIncludes(memberAgreement, 'role="link"', '共享协议组件入口必须使用原生交互控件')
expectIncludes(memberAgreement, '<Link className="doclink" to="/legal/terms">', '共享协议组件用户协议必须使用原生链接语义')
expectIncludes(memberAgreement, '<Link className="doclink" to="/legal/privacy">', '共享协议组件隐私政策必须使用原生链接语义')
expectPattern(
  memberPhoneLoginPane,
  /const canSend = agreed && phone\.length === MEMBER_PHONE_LENGTH && countdown === 0 && !loading/,
  '共享手机号面板未同意协议时不得启用发送验证码',
)
expectPattern(
  memberPhoneLoginPane,
  /const canLogin = \([\s\S]{0,160}?agreed &&[\s\S]{0,160}?phone\.length === MEMBER_PHONE_LENGTH &&[\s\S]{0,160}?code\.length === MEMBER_CODE_LENGTH &&[\s\S]{0,80}?!loading[\s\S]{0,40}?\)/,
  '共享手机号面板未同意协议时不得启用登录',
)
expectIncludes(memberAgreement, '勾选协议后可获取验证码并登录', '共享协议组件禁用门禁必须有可见原因')
expect(
  (memberPhoneLoginPane.match(/role="alert"/g) ?? []).length === 1,
  '共享手机号面板只允许一个错误 alert 区，扫码错误由 ScanQrLoginPanel 自己播报',
)

expectNotIncludes(kioskRoot, 'label={deviceStatus}', 'KioskRoot 不得直接展示内部 deviceStatus')
expectIncludes(kioskRoot, 'const statusLabel =', 'KioskRoot 必须把设备状态映射为用户文案')
expectIncludes(kioskRoot, "busy: '正在服务'", 'KioskRoot busy 状态不得误写为维护中')

expectIncludes(mobileQrPage, 'k1-mobile-qr-invalid', 'MobileQrLoginPage 缺票据或失效时必须使用单一恢复状态')
expectPattern(
  mobileQrPage,
  /!ready\s*\?\s*\([\s\S]*?k1-mobile-qr-invalid[\s\S]*?\)\s*:\s*\(/,
  'MobileQrLoginPage 只有 ready 后才能展示确认表单',
)
expectIncludes(mobileQrPage, 'k1-mobile-qr-error', 'MobileQrLoginPage ready 后必须保留短信或确认失败提示')
expectIncludes(phoneUploadPage, 'phone-upload-invalid', 'PhoneUploadPage 缺少令牌时必须使用单一恢复状态')
expectPattern(
  phoneUploadPage,
  /!ready\s*\?\s*\([\s\S]*?phone-upload-invalid[\s\S]*?\)\s*:\s*\(/,
  'PhoneUploadPage 只有 ready 后才能展示文件选择器',
)

for (const forbiddenCopy of ['一键投递', '立即投递', '平台投递']) {
  for (const [source, label] of [
    [loginPage, 'LoginPage'],
    [memberPhoneLoginHook, 'useMemberPhoneLogin'],
    [memberPhoneLoginPane, 'MemberPhoneLoginPane'],
    [memberAgreement, 'MemberAgreement'],
    [mobileQrPage, 'MobileQrLoginPage'],
    [scanQrPanel, 'ScanQrLoginPanel'],
    [phoneUploadPage, 'PhoneUploadPage'],
    [legalDocPage, 'LegalDocPage'],
    [screensaverPage, 'ScreensaverPage'],
    [helpCenterPage, 'HelpCenterPage'],
  ]) {
    expectNotIncludes(source, forbiddenCopy, `${label} 公共入口文案`)
  }
}

expectNotIncludes(helpCenterPage, 'const answerId = `help-answer-${item.q}`', 'HelpCenterPage FAQ a11y ID 不得直接使用问题文本')
expectPattern(
  helpCenterPage,
  /section\.items\.map\(\(item,\s*itemIndex\)\s*=>[\s\S]*?<QaRow\s+key=\{item\.q\}\s+item=\{item\}\s+answerId=\{`help-answer-\$\{section\.key\}-\$\{itemIndex\}`\}/,
  'HelpCenterPage FAQ a11y ID 必须使用无空白的 section key 与索引',
)
expectPattern(
  helpCenterPage,
  /function QaRow\(\{\s*item,\s*answerId,\s*onNavigate\s*\}/,
  'HelpCenterPage QaRow 必须接收稳定 FAQ answerId',
)

const pageRoots = new Map()
for (const [source, componentName, rootClass, label] of [
  [loginPage, 'LoginPage', 'k1-login', 'LoginPage'],
  [mobileQrPage, 'MobileQrLoginPage', 'k1-mobile-qr-login', 'MobileQrLoginPage'],
  [scanQrPanel, 'ScanQrLoginPanel', 'k1-scan-qr-login', 'ScanQrLoginPanel'],
  [phoneUploadPage, 'PhoneUploadPage', 'k1-phone-upload', 'PhoneUploadPage'],
  [legalDocPage, 'LegalDocPage', 'k1-legal-doc', 'LegalDocPage'],
  [screensaverPage, 'ScreensaverPage', 'k1-screensaver', 'ScreensaverPage'],
  [helpCenterPage, 'HelpCenterPage', 'k1-help-center', 'HelpCenterPage'],
]) {
  pageRoots.set(componentName, expectPageRootClasses(source, componentName, rootClass, label))
}

for (const [componentName, label] of [
  ['LoginPage', 'LoginPage'],
  ['MobileQrLoginPage', 'MobileQrLoginPage'],
  ['PhoneUploadPage', 'PhoneUploadPage'],
  ['LegalDocPage', 'LegalDocPage'],
  ['ScreensaverPage', 'ScreensaverPage'],
]) {
  const root = pageRoots.get(componentName) ?? ''
  expectStandaloneServiceDeskAttributes(root, label)
}

const loginAggregatePath = 'src/pages/auth/login.css'
const loginStylePaths = [
  'src/pages/auth/styles/login-shell.css',
  'src/pages/auth/styles/login-form.css',
  'src/pages/auth/styles/login-keypad.css',
  'src/pages/auth/styles/login-responsive.css',
]
const loginAggregate = read(loginAggregatePath)
const expectedImports = loginStylePaths.map((path) => `@import './styles/${path.split('/').at(-1)}';`)
const aggregateLines = loginAggregate.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
expect(
  aggregateLines.length === expectedImports.length && expectedImports.every((line, index) => aggregateLines[index] === line),
  'login.css 必须只按固定顺序聚合四个职责 CSS 文件',
)
expect(lineCount(loginAggregate) < 300, `login.css 必须少于 300 行（当前 ${lineCount(loginAggregate)}）`)
expectIncludes(loginPage, "import './login.css'", 'LoginPage 必须导入 login.css 聚合样式')

const loginStyleSources = new Map(
  loginStylePaths.map((path) => [path, expectCssContract(path, 'k1-login', { reducedMotion: path.endsWith('login-responsive.css') })]),
)
const loginResponsive = loginStyleSources.get('src/pages/auth/styles/login-responsive.css') ?? ''
for (const viewport of ['1080x1920', '390x844', '390x700']) {
  expectPattern(
    loginResponsive,
    new RegExp(escapeRegExp(viewport).replace('x', '\\s*(?:x|×)\\s*'), 'i'),
    `login-responsive.css 必须标记 ${viewport} 响应式矩阵`,
  )
}

for (const { page, cssPath, rootClass, label } of [
  {
    page: mobileQrPage,
    cssPath: 'src/pages/auth/mobile-qr-service-desk.css',
    rootClass: 'k1-mobile-qr-login',
    label: 'MobileQrLoginPage',
  },
  {
    page: phoneUploadPage,
    cssPath: 'src/pages/upload/phone-upload-service-desk.css',
    rootClass: 'k1-phone-upload',
    label: 'PhoneUploadPage',
  },
  {
    page: legalDocPage,
    cssPath: 'src/pages/legal/legal-service-desk.css',
    rootClass: 'k1-legal-doc',
    label: 'LegalDocPage',
  },
  {
    page: screensaverPage,
    cssPath: 'src/pages/screensaver/screensaver-service-desk.css',
    rootClass: 'k1-screensaver',
    label: 'ScreensaverPage',
  },
  {
    page: helpCenterPage,
    cssPath: 'src/pages/help/help-service-desk.css',
    rootClass: 'k1-help-center',
    label: 'HelpCenterPage',
  },
]) {
  const importPath = `./${cssPath.split('/').at(-1)}`
  expectIncludes(page, `import '${importPath}'`, `${label} 必须导入 ${importPath}`)
  expectCssContract(cssPath, rootClass)
}

if (failures > 0) {
  console.error(`[K1_PUBLIC_ENTRY_VERIFY_FAILED] 共 ${failures} 项 LightFlow K1 公共入口合同未满足`)
  process.exitCode = 1
} else {
  console.log('verify-lightflow-k1-public-entry: ok')
}
