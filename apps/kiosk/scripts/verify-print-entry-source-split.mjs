import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

/** 照 verify-fusion-w6.mjs：标识符或字符串字面量才算属性名，计算属性读不出名字。 */
function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null
}

function unwrapExpression(node) {
  let current = node
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression
  }
  return current
}

/** 对象字面量的直接属性名。展开、方法、简写、计算属性一律不当成允许键。 */
function objectLiteralKeys(node) {
  const expr = unwrapExpression(node)
  if (!expr || !ts.isObjectLiteralExpression(expr)) {
    return { ok: false, reason: '去确认页的 state 不是对象字面量' }
  }
  const keys = []
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || ts.isComputedPropertyName(prop.name)) {
      return { ok: false, reason: '去确认页的 state 含有展开、简写或计算属性' }
    }
    const name = propertyName(prop.name)
    if (!name) return { ok: false, reason: '去确认页的 state 读不出属性名' }
    keys.push(name)
  }
  return { ok: true, keys }
}

/** 三元的两个分支都收成对象字面量；嵌套三元继续往下收。 */
function stateBranches(node) {
  const expr = unwrapExpression(node)
  if (!expr) return { ok: false, reason: '去确认页没有 state' }
  if (ts.isConditionalExpression(expr)) {
    const whenTrue = stateBranches(expr.whenTrue)
    const whenFalse = stateBranches(expr.whenFalse)
    if (!whenTrue.ok) return whenTrue
    if (!whenFalse.ok) return whenFalse
    return { ok: true, branches: [...whenTrue.branches, ...whenFalse.branches] }
  }
  const literal = objectLiteralKeys(expr)
  if (!literal.ok) return literal
  return { ok: true, branches: [literal.keys] }
}

const CONFIRM_ROUTE_STATE_KEYS = new Set(['printContextId', 'printReturnState'])
const CONFIRM_PATH = '/print/confirm'

/** 字符串、无插值模板、以及能折起来的字符串拼接。其余（模板插值、变量、对象）认不出目标页。 */
function staticNavigatePath(node) {
  const expr = unwrapExpression(node)
  if (!expr) return null
  if (ts.isStringLiteralLike(expr)) return expr.text
  if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.PlusToken) return null
  const left = staticNavigatePath(expr.left)
  const right = staticNavigatePath(expr.right)
  if (left === null || right === null) return null
  return left + right
}

function isClearlyNotRouteOptions(expr) {
  return (
    ts.isStringLiteralLike(expr) ||
    ts.isNumericLiteral(expr) ||
    ts.isRegularExpressionLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    ts.isTemplateExpression(expr) ||
    ts.isArrowFunction(expr) ||
    ts.isFunctionExpression(expr) ||
    ts.isArrayLiteralExpression(expr) ||
    ts.isPrefixUnaryExpression(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword ||
    expr.kind === ts.SyntaxKind.UndefinedKeyword
  )
}

/**
 * 第二个参数（或写成对象的目标）里有没有 state。
 * 对象字面量能数清键：没有 state 就是没有。展开、计算属性、变量、调用都认不出。
 */
function routeOptionsState(node) {
  const expr = unwrapExpression(node)
  if (!expr) return { kind: 'unknown', reason: '参数是空的，认不出带没带路由状态' }
  if (ts.isObjectLiteralExpression(expr)) {
    const inits = []
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        return { kind: 'unknown', reason: '参数对象含有展开，认不出带没带路由状态' }
      }
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) {
        return { kind: 'unknown', reason: '参数对象含有方法或计算属性，认不出带没带路由状态' }
      }
      if (ts.isComputedPropertyName(prop.name)) {
        return { kind: 'unknown', reason: '参数对象含有计算属性，认不出带没带路由状态' }
      }
      const name = propertyName(prop.name)
      if (!name) return { kind: 'unknown', reason: '参数对象读不出属性名，认不出带没带路由状态' }
      if (name === 'state') inits.push(ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.initializer)
    }
    return inits.length > 0 ? { kind: 'present', inits } : { kind: 'none' }
  }
  if (ts.isConditionalExpression(expr)) {
    const whenTrue = routeOptionsState(expr.whenTrue)
    const whenFalse = routeOptionsState(expr.whenFalse)
    if (whenTrue.kind === 'unknown') return whenTrue
    if (whenFalse.kind === 'unknown') return whenFalse
    const inits = [
      ...(whenTrue.kind === 'present' ? whenTrue.inits : []),
      ...(whenFalse.kind === 'present' ? whenFalse.inits : []),
    ]
    return inits.length > 0 ? { kind: 'present', inits } : { kind: 'none' }
  }
  if (isClearlyNotRouteOptions(expr)) return { kind: 'none' }
  return { kind: 'unknown', reason: '参数不是对象字面量，认不出带没带路由状态' }
}

function propertyAccess(node) {
  const expr = unwrapExpression(node)
  if (!expr || !ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.expression)) return null
  return { objectName: expr.expression.text, property: expr.name.text }
}

/** 期望的每个键都是同一个标识符的同名属性，且没有别的属性。 */
function sameObjectShape(node, keys) {
  const expr = unwrapExpression(node)
  if (!expr || !ts.isObjectLiteralExpression(expr) || expr.properties.length !== keys.length) return null
  let objectName = null
  const seen = new Set()
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || ts.isComputedPropertyName(prop.name)) return null
    const name = propertyName(prop.name)
    if (!name || !keys.includes(name) || seen.has(name)) return null
    const access = propertyAccess(prop.initializer)
    if (!access || access.property !== name) return null
    if (objectName === null) objectName = access.objectName
    else if (objectName !== access.objectName) return null
    seen.add(name)
  }
  return seen.size === keys.length ? objectName : null
}

/**
 * 预览页返回上一步时，把 readPrintReturnCarry 已经校验过的回执原样交回去。
 * 这一处不在本文件里新写状态键。别的形状不能借用这个例外。
 */
function isReturnCarryForward(call, source) {
  if (call.arguments.length < 2) return false
  const objectName = sameObjectShape(call.arguments[0], ['pathname', 'search'])
  if (!objectName || sameObjectShape(call.arguments[1], ['state']) !== objectName) return false
  const inits = []
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === objectName &&
      node.initializer
    ) {
      inits.push(unwrapExpression(node.initializer))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (inits.length !== 1) return false
  const init = inits[0]
  return Boolean(init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'readPrintReturnCarry')
}

function allowStateKeys(stateInit) {
  const collected = stateBranches(stateInit)
  if (!collected.ok) return collected
  for (const keys of collected.branches) {
    if (!keys.includes('printContextId')) {
      return { ok: false, reason: '每个分支都要带交接编号 printContextId' }
    }
    const extra = keys.filter((key) => !CONFIRM_ROUTE_STATE_KEYS.has(key))
    if (extra.length > 0) {
      return { ok: false, reason: `路由状态出现允许名单之外的键：${extra.join(',')}` }
    }
  }
  return { ok: true, reason: '' }
}

/**
 * 预览页只承认一种跳转函数：`const 名字 = useNavigate()` 直接赋上的那个名字。
 * 只承认两种调用：`名字(路径)`，以及 `名字(路径, { state: { 允许名单里的键 } })`。
 * 别的任何引用（别名、传参、成员调用、call/apply/bind、逗号或赋值表达式当被调用者、
 * useNavigate()() 连调、展开参数、第二个参数不是对象字面量）一律判红，并写明是哪一种。
 * 回执原样交还的那一次除外。参数里已经写成对象字面量的 state，不论调用者是谁，仍按名单查键。
 */
function isUseNavigateCall(node) {
  const expr = unwrapExpression(node)
  if (!expr || !ts.isCallExpression(expr) || expr.arguments.length !== 0) return false
  const callee = unwrapExpression(expr.expression)
  return Boolean(callee && ts.isIdentifier(callee) && callee.text === 'useNavigate')
}

function collectNavigateBindings(source) {
  const names = new Set()
  const declNames = new Set()
  const initCallees = new Set()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isUseNavigateCall(node.initializer)
    ) {
      names.add(node.name.text)
      declNames.add(node.name)
      initCallees.add(unwrapExpression(node.initializer).expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { names, declNames, initCallees }
}

function isInImport(node) {
  let current = node
  while (current) {
    if (ts.isImportDeclaration(current)) return true
    current = current.parent
  }
  return false
}

function isDeclarationName(node) {
  const parent = node.parent
  if (!parent) return false
  if ((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent)) && parent.name === node) {
    return true
  }
  return ts.isBindingElement(parent) && parent.name === node
}

function isPropertyNameOnly(node) {
  const parent = node.parent
  if (!parent) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true
  return ts.isBindingElement(parent) && parent.propertyName === node
}

function isArgumentOfCall(node) {
  const parent = node.parent
  if (!parent) return false
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments && [...parent.arguments].includes(node)) {
    return true
  }
  return ts.isSpreadElement(parent) && parent.expression === node
}

/** 顺着括号、逗号、赋值往上走。这个标识符若处在一次调用的被调用者位置，返回是哪一种。 */
function calleeCarrier(start) {
  let current = start
  let sawComma = false
  let sawAssign = false
  while (current.parent) {
    const parent = current.parent
    if (ts.isParenthesizedExpression(parent) && parent.expression === current) {
      current = parent
      continue
    }
    if (ts.isBinaryExpression(parent) && (parent.left === current || parent.right === current)) {
      const kind = parent.operatorToken.kind
      if (kind === ts.SyntaxKind.CommaToken) {
        sawComma = true
        current = parent
        continue
      }
      if (kind === ts.SyntaxKind.EqualsToken) {
        sawAssign = true
        current = parent
        continue
      }
      return null
    }
    if (ts.isCallExpression(parent) && unwrapExpression(parent.expression) === unwrapExpression(current)) {
      if (sawComma) return 'comma'
      if (sawAssign) return 'assign'
      return null
    }
    return null
  }
  return null
}

function isAliasAssignment(node) {
  const parent = node.parent
  if (!parent) return false
  if (ts.isVariableDeclaration(parent) && parent.initializer && unwrapExpression(parent.initializer) === node) return true
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    unwrapExpression(parent.right) === node
  ) {
    return true
  }
  if (ts.isPropertyAssignment(parent) && unwrapExpression(parent.initializer) === node) return true
  return ts.isShorthandPropertyAssignment(parent) && parent.name === node
}

function classifyUseNavigate(node) {
  const parent = node.parent
  if (parent && ts.isCallExpression(parent) && parent.expression === node) {
    let outer = parent.parent
    while (outer && ts.isParenthesizedExpression(outer)) outer = outer.parent
    if (outer && ts.isCallExpression(outer) && unwrapExpression(outer.expression) === parent) {
      return 'useNavigate()(…) 连调'
    }
    if (isArgumentOfCall(parent)) return '当参数传出去'
    return 'useNavigate() 没有直接赋给变量'
  }
  const carrier = calleeCarrier(node)
  if (carrier === 'comma') return '逗号表达式当被调用者'
  if (carrier === 'assign') return '赋值表达式当被调用者'
  if (isArgumentOfCall(node) || isAliasAssignment(node)) return isAliasAssignment(node) ? '别名赋值' : '当参数传出去'
  return 'useNavigate 出现在不允许的位置'
}

function classifyBoundName(node) {
  const parent = node.parent
  if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    const prop = parent.name.text
    if (prop === 'call' || prop === 'apply' || prop === 'bind') return { type: 'forbidden', reason: `.${prop}` }
    return { type: 'forbidden', reason: '成员调用' }
  }
  if (parent && ts.isElementAccessExpression(parent) && parent.expression === node) {
    return { type: 'forbidden', reason: '成员调用' }
  }
  if (parent && ts.isCallExpression(parent) && parent.expression === node) {
    return { type: 'allowed-call', call: parent }
  }
  const carrier = calleeCarrier(node)
  if (carrier === 'comma') return { type: 'forbidden', reason: '逗号表达式当被调用者' }
  if (carrier === 'assign') return { type: 'forbidden', reason: '赋值表达式当被调用者' }
  if (isAliasAssignment(node)) return { type: 'forbidden', reason: '别名赋值' }
  if (isArgumentOfCall(node)) return { type: 'forbidden', reason: '当参数传出去' }
  return { type: 'forbidden', reason: '引用了 navigate，但不是允许的两种跳转写法' }
}

function memberCallReason(call) {
  const expr = unwrapExpression(call.expression)
  if (!expr) return null
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'navigate') return '成员调用'
  if (ts.isElementAccessExpression(expr)) {
    const arg = unwrapExpression(expr.argumentExpression)
    if (arg && ts.isStringLiteralLike(arg) && arg.text === 'navigate') return '成员调用'
  }
  return null
}

function visibleStateReasons(call, source) {
  if (isReturnCarryForward(call, source)) return []
  const reasons = []
  for (const arg of call.arguments) {
    if (ts.isSpreadElement(arg)) {
      reasons.push('调用参数是展开，认不出带没带路由状态')
      continue
    }
    const status = routeOptionsState(arg)
    if (status.kind !== 'present') continue
    for (const init of status.inits) {
      const allowed = allowStateKeys(init)
      if (!allowed.ok) reasons.push(allowed.reason)
    }
  }
  return reasons
}

function checkDirectCall(call, source) {
  for (const arg of call.arguments) {
    if (ts.isSpreadElement(arg)) return { reason: '展开参数', isConfirm: false }
  }
  if (isReturnCarryForward(call, source)) return { reason: null, isConfirm: false }
  if (call.arguments.length === 1) {
    const status = routeOptionsState(call.arguments[0])
    if (status.kind === 'present') {
      for (const init of status.inits) {
        const allowed = allowStateKeys(init)
        if (!allowed.ok) return { reason: allowed.reason, isConfirm: false }
      }
    }
    if (staticNavigatePath(call.arguments[0]) === CONFIRM_PATH) return { reason: 'navigate 没有 state', isConfirm: false }
    return { reason: null, isConfirm: false }
  }
  if (call.arguments.length === 2) {
    const second = unwrapExpression(call.arguments[1])
    if (!second || !ts.isObjectLiteralExpression(second)) {
      return { reason: '第二个参数不是对象字面量', isConfirm: false }
    }
    let stateInit = null
    for (const prop of second.properties) {
      if (ts.isSpreadAssignment(prop) || !ts.isPropertyAssignment(prop) || ts.isComputedPropertyName(prop.name)) {
        return { reason: '第二个参数不是对象字面量', isConfirm: false }
      }
      const name = propertyName(prop.name)
      if (name !== 'state' || stateInit) return { reason: '第二个参数不是只带 state 的对象字面量', isConfirm: false }
      stateInit = prop.initializer
    }
    if (!stateInit) return { reason: 'navigate 没有 state', isConfirm: false }
    const allowed = allowStateKeys(stateInit)
    if (!allowed.ok) return { reason: allowed.reason, isConfirm: false }
    return { reason: null, isConfirm: staticNavigatePath(call.arguments[0]) === CONFIRM_PATH }
  }
  return { reason: '不是允许的两种跳转写法', isConfirm: false }
}

function confirmRouteStateAllowed(sourceText) {
  const source = ts.createSourceFile('PrintPreviewPage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const bindings = collectNavigateBindings(source)
  const reasons = []
  let confirmCalls = 0
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expr = unwrapExpression(node.expression)
      const direct = Boolean(expr && ts.isIdentifier(expr) && bindings.names.has(expr.text))
      if (direct) {
        const result = checkDirectCall(node, source)
        if (result.reason) reasons.push(result.reason)
        if (result.isConfirm) confirmCalls += 1
      } else {
        const member = memberCallReason(node)
        if (member) reasons.push(member)
        reasons.push(...visibleStateReasons(node, source))
      }
    }
    if (ts.isIdentifier(node) && !isInImport(node) && !isDeclarationName(node) && !isPropertyNameOnly(node)) {
      if (bindings.initCallees.has(node) || bindings.declNames.has(node)) {
        ts.forEachChild(node, visit)
        return
      }
      if (node.text === 'useNavigate') reasons.push(classifyUseNavigate(node))
      else if (bindings.names.has(node.text)) {
        const issue = classifyBoundName(node)
        if (issue.type === 'forbidden') reasons.push(issue.reason)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const unique = [...new Set(reasons)]
  if (unique.length > 0) return { ok: false, reason: unique.join('；') }
  if (confirmCalls !== 1) {
    return { ok: false, reason: `预览页去确认页的 navigate 应只有一处，实际 ${confirmCalls} 处` }
  }
  return { ok: true, reason: '' }
}

const homeServiceGroups = read('src/pages/home/serviceGroups.ts')
const uploadPage = [
  read('src/pages/print/PrintUploadPage.tsx'),
  read('src/pages/print/file-source/FileSourceView.tsx'),
  read('src/pages/print/file-source/FileSourceBits.tsx'),
].join('\n')
const session = read('src/pages/print/printMaterialSession.ts')
const flowPages = [
  'src/pages/print/PrintMaterialCheckPage.tsx',
  'src/pages/print/PrintPreviewPage.tsx',
  'src/pages/print/PrintConfirmPage.tsx',
  'src/pages/print/PrintProgressPage.tsx',
  'src/pages/print/PrintDonePage.tsx',
]
const materialCheckPage = read('src/pages/print/PrintMaterialCheckPage.tsx')
const previewPage = read('src/pages/print/PrintPreviewPage.tsx')
const confirmPage = read('src/pages/print/PrintConfirmPage.tsx')

assert(
  /title:\s*'简历打印'[\s\S]*?to:\s*'\/print\/upload\?source=resume'/.test(homeServiceGroups),
  '首页 AI 简历服务的简历打印入口进入 source=resume 打印流',
)

assert(
  /title:\s*'文档打印'[\s\S]*?to:\s*'\/print\/upload\?source=document'/.test(homeServiceGroups),
  '首页打印扫描的文档打印入口进入 source=document 打印流',
)

assert(
  uploadPage.includes("source === 'resume'") &&
    uploadPage.includes('简历打印') &&
    uploadPage.includes('查看我的简历记录') &&
    uploadPage.includes("navigate('/me/resumes')"),
  'PrintUploadPage 根据 source=resume 展示简历打印语义与我的简历记录入口',
)

// 简历打印与文档打印共用三种上传通道；不得再把 source=resume 收成单一「上传简历」Tab。
assert(
  uploadPage.includes('本机选文件') &&
    uploadPage.includes('手机扫码上传') &&
    uploadPage.includes('U 盘导入') &&
    !/isResumePrint\s*\?\s*\[[\s\S]*?key:\s*'file'[\s\S]*?\]\s*:\s*\[/.test(uploadPage),
  'PrintUploadPage 简历打印同样提供本机上传 / 扫码上传 / U盘导入',
)
assert(
  !/KioskPageFrame/.test(uploadPage),
  'PrintUploadPage has left the V6 frame',
)

assert(
  uploadPage.includes("source === 'document'") &&
    uploadPage.includes('文档打印') &&
    uploadPage.includes('通用文档、求职材料或图片'),
  'PrintUploadPage 保留 source=document 的通用文档打印语义',
)

assert(
  session.includes("PrintMaterialSource = 'resume' | 'document'") &&
    session.includes('source?: PrintMaterialSource') &&
    session.includes("source: next.source === 'resume' || next.source === 'document' ? next.source : undefined") &&
    session.includes('printUploadPathForSource'),
  'printMaterialSession（打印交接上下文 v2）支持保存打印来源 source，并集中生成回到上传页的路径',
)

// 2026-09-29 商用收口 P0-5：上传成功只把文件放进本页，不再写打印交接上下文 ——
// 以前上传成功就写，不点「下一步」也留在本机，会被下一位或下一个来源当成「上一份」复水。
// 点「下一步」才整份写（origin: 'upload'，带 source 与 contentCategory），跳转只带交接编号。
const persistStart = uploadPage.indexOf('const persistFile')
const persistBody = uploadPage.slice(persistStart, uploadPage.indexOf('}, [])', persistStart))
assert(
  persistStart >= 0 && persistBody.includes('clearPrintMaterialSession()') && !/startPrint|beginPrintHandoff|savePrintMaterialSession/.test(persistBody),
  'persistFile 上传成功只放进本页并作废旧的打印交接，不提前写交接上下文',
)
const nextStart = uploadPage.indexOf('const handleNext')
const nextBody = uploadPage.slice(nextStart, uploadPage.indexOf('\n  }\n', nextStart))
assert(
  nextStart >= 0 && /startPrint\(\{\s*origin:\s*'upload',\s*file,\s*source,/.test(nextBody) && nextBody.includes('contentCategory: resolveContentCategory(contentCategory, file.mimeType)'),
  '「下一步」整份写打印交接上下文（origin upload，带 source 与内容类别）再进打印台检查',
)
for (const [handler, marker] of [
  ['uploadLocalFile', 'persistFile(nextFile, \'file\')'],
  ['handleQrUploaded', 'persistFile(nextFile, \'qr\')'],
  ['handleUsbImport', 'persistFile(nextFile, \'usb\')'],
]) {
  const start = uploadPage.indexOf(`const ${handler}`)
  const nextTopLevelDecl = uploadPage.indexOf('\n  const ', start + 1)
  const body = uploadPage.slice(start, nextTopLevelDecl === -1 ? undefined : nextTopLevelDecl)
  assert(
    start >= 0 && body.includes(marker),
    `${handler} 上传成功后经 persistFile 放进本页`,
  )
}

// 打印链只从打印交接上下文读 source。去确认页的路由状态是允许名单：
// 只许交接编号 printContextId 和已经校验过的回执 printReturnState。
const carryAt = previewPage.indexOf('const carriedReturn = readPrintReturnCarry(')
const carryEnd = previewPage.indexOf('\n  }\n', carryAt)
const carrySlice = carryAt >= 0 ? previewPage.slice(carryAt, carryEnd) : ''
const routeState = confirmRouteStateAllowed(previewPage)
assert(
  routeState.ok,
  `去确认页的路由状态只许交接编号和回执：${routeState.reason || '通过'}`,
)
assert(
  materialCheckPage.includes('const source = session?.source ?? handoff?.source') &&
    !materialCheckPage.includes('location.state') &&
    previewPage.includes('const source = handoff?.source') &&
    carrySlice.includes("navigate('/print/confirm'") &&
    carrySlice.includes('printContextId: saved.contextId') &&
    carrySlice.includes('printReturnState: carriedReturn') &&
    confirmPage.includes('const source = handoff?.source') &&
    !/state\?\.(file|params|source|materialCheck)\b/.test(confirmPage),
  '打印流程只从打印交接上下文读 source 与文件身份；去确认页只多带校验过的回执返回状态',
)

for (const file of flowPages) {
  const source = read(file)
  assert(
    source.includes('printUploadPathForSource') && !source.includes("navigate('/print/upload')"),
    `${file} 返回上传页时保留当前打印来源 source`,
  )
}

function previewSource(body) {
  return `function Page() {\n  const navigate = useNavigate()\n${body}\n}\n`
}

function assertRouteRejected(body, reasonPart, label) {
  const result = confirmRouteStateAllowed(previewSource(body))
  const passed = !result.ok && result.reason.includes(reasonPart)
  assert(passed, passed ? label : `${label}应判红（${reasonPart}），实际 ${result.ok ? '通过' : result.reason}`)
}

function assertRouteAllowed(body, label) {
  const result = confirmRouteStateAllowed(previewSource(body))
  assert(result.ok, result.ok ? label : `${label}应通过，实际 ${result.reason}`)
}

const leaked = "{ state: { printContextId: 'ctx', fileUrl: 'https://recv.test/leaked' } }"
const allowedState = "{ state: { printContextId: 'ctx' } }"
const variableOptions = `  const recvOptions = { state: { printContextId: 'ctx', fileUrl: 'https://recv.test/leaked' } }\n`

assertRouteAllowed(
  `  navigate('/print/desk')\n  navigate(-1)\n  navigate('/print/confirm', ${allowedState})`,
  '直接调用：单参数路径，以及只带交接编号',
)
assertRouteAllowed(
  `  const carried = null\n  navigate('/print/confirm', { state: carried ? { printContextId: 'ctx', printReturnState: carried } : { printContextId: 'ctx' } })`,
  '直接调用，state 是三元，键都在允许名单里',
)
assertRouteRejected(
  `  const go = navigate\n  go('/print/confirm', ${allowedState})`,
  '别名赋值',
  '别名即使只带交接编号',
)
assertRouteRejected(
  `  const router = { navigate }\n  router.navigate('/print/confirm', ${allowedState})`,
  '成员调用',
  '属性调用 router.navigate 即使只带交接编号',
)
assertRouteRejected(
  `  const nav = { current: navigate }\n  nav.current('/print/confirm', ${allowedState})`,
  '别名赋值',
  '把 navigate 放进对象再调用，即使只带交接编号',
)
assertRouteRejected(
  `  const go = navigate\n  go('/print/confirm', ${leaked})`,
  'fileUrl',
  '别名调用带允许名单之外的键',
)
assertRouteRejected(
  `  const router = { navigate }\n  router.navigate('/print/confirm', ${leaked})`,
  'fileUrl',
  '属性调用 router.navigate 带允许名单之外的键',
)
assertRouteRejected(
  `  const nav = { current: navigate }\n  nav.current('/print/where', ${leaked})`,
  'fileUrl',
  '属性调用 nav.current 带允许名单之外的键',
)
assertRouteRejected(
  `  const recvRouter = { go: navigate }\n  recvRouter.go('/print/confirm', ${leaked})`,
  'fileUrl',
  '属性调用 recvRouter.go 带允许名单之外的键',
)
assertRouteRejected(
  `  const recvArgs = ['/print/confirm', ${leaked}]\n  navigate(...recvArgs)`,
  '展开',
  'navigate 整组参数展开',
)
assertRouteRejected(
  `  const recvRouter = { go: navigate }\n  const recvArgs = ['/print/confirm', ${leaked}]\n  recvRouter.go(...recvArgs)`,
  '展开',
  '属性调用整组参数展开',
)
assertRouteRejected(
  `  const go = navigate\n  const options = ${leaked}\n  go('/print/confirm', options)`,
  '别名赋值',
  '别名赋值，即使第二个参数是变量',
)
assertRouteRejected(
  `  const router = { navigate }\n  const options = ${allowedState}\n  router.navigate('/print/confirm', options)`,
  '成员调用',
  '成员调用，即使第二个参数是变量',
)
assertRouteRejected(
  `  const options = ${leaked}\n  navigate('/print/confirm', options)`,
  '第二个参数不是对象字面量',
  '直接调用的第二个参数是变量',
)
assertRouteRejected(
  `${variableOptions}  useNavigate()('/print/confirm', recvOptions)`,
  '连调',
  'useNavigate()(path, 变量) 连调',
)
assertRouteRejected(
  `${variableOptions}  const getNav = () => ({ navigate })\n  getNav().navigate('/print/confirm', recvOptions)`,
  '成员调用',
  'getNav().navigate(path, 变量)',
)
assertRouteRejected(
  `${variableOptions}  ;(0, navigate)('/print/confirm', recvOptions)`,
  '逗号表达式当被调用者',
  '(0, navigate)(path, 变量)',
)
assertRouteRejected(
  `  navigate.call(null, '/print/confirm', { state: { printContextId: 'ctx', fileUrl: 'https://recv.test/leaked' } })`,
  '.call',
  'navigate.call',
)
assertRouteRejected(
  `  const path = '/print/confirm'\n  const state = { printContextId: 'ctx', fileUrl: 'https://recv.test/leaked' }\n  navigate.apply(null, [path, { state }])`,
  '.apply',
  'navigate.apply',
)
assertRouteRejected(
  `${variableOptions}  navigate.bind(null)('/print/confirm', recvOptions)`,
  '.bind',
  'navigate.bind 再调用',
)
assertRouteRejected(
  `${variableOptions}  ;(go = navigate)('/print/confirm', recvOptions)`,
  '赋值表达式当被调用者',
  '赋值表达式当被调用者',
)
assertRouteRejected(
  `  foo(navigate)\n  navigate('/print/confirm', ${allowedState})`,
  '当参数传出去',
  '把 navigate 当参数传出去',
)
assertRouteRejected(
  `  const path = '/print/confirm'\n  navigate(path, ${leaked})`,
  'fileUrl',
  '变量路径带允许名单之外的键',
)
assertRouteRejected(
  `  navigate('/print' + '/confirm', ${leaked})`,
  'fileUrl',
  '拼接路径带允许名单之外的键',
)
assertRouteRejected(
  '  navigate(`/print/confirm`, ' + leaked + ')',
  'fileUrl',
  '模板路径带允许名单之外的键',
)
const importedHelper = confirmRouteStateAllowed(`
import { helper } from './helper'
function Page() {
  const navigate = useNavigate()
  navigate('/print/confirm', { state: { printContextId: 'ctx' } })
  helper('/print/elsewhere', { state: { printContextId: 'ctx', fileUrl: 'https://recv.test/leaked' } })
}
`)
{
  const passed = !importedHelper.ok && importedHelper.reason.includes('fileUrl')
  assert(
    passed,
    passed ? 'import 进来的函数只要带了 state 也查允许名单' : `import 进来的函数带了 state 时应判红，实际 ${importedHelper.ok ? '通过' : importedHelper.reason}`,
  )
}

console.log('\nALL PASS')
