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

/**
 * 这些名字的调用不是跳转：语言内建、本文件的 import、本文件声明的函数。
 * 它们的第二个参数经常是变量，读不出里面有没有 state，不能据此把预览页判红。
 * 名叫 navigate 的导入或函数声明不放进这张表，避免把跳转函数本身放行。
 */
const NON_ROUTE_INTRINSICS = new Set([
  'Math', 'Object', 'Array', 'JSON', 'Number', 'String', 'Boolean', 'Date', 'Promise',
  'console', 'window', 'document', 'globalThis', 'Intl', 'RegExp', 'Error', 'Map', 'Set',
  'Reflect', 'Symbol', 'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'queueMicrotask',
  'structuredClone', 'AbortController', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'fetch', 'localStorage', 'sessionStorage',
])

function nonRouteCalleeNames(source) {
  const names = new Set(NON_ROUTE_INTRINSICS)
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause
      if (clause.name && clause.name.text !== 'navigate') names.add(clause.name.text)
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        if (bindings.name.text !== 'navigate') names.add(bindings.name.text)
      } else if (bindings) {
        for (const spec of bindings.elements) {
          const imported = spec.propertyName ? spec.propertyName.text : spec.name.text
          if (imported !== 'navigate' && spec.name.text !== 'navigate') names.add(spec.name.text)
        }
      }
      return
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text !== 'navigate') {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

/** 跳转函数、别名、对象上的属性调用要查清状态。import 进来的普通函数和语言内建不是。 */
function calleeClass(node, nonRouteNames) {
  const expr = unwrapExpression(node)
  if (!expr) return 'route'
  if (ts.isIdentifier(expr)) return nonRouteNames.has(expr.text) ? 'other' : 'route'
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return calleeClass(expr.expression, nonRouteNames) === 'other' ? 'other' : 'route'
  }
  if (ts.isCallExpression(expr) || ts.isNewExpression(expr)) {
    const callee = unwrapExpression(expr.expression)
    if (callee && ts.isIdentifier(callee) && callee.text === 'useRef') return 'route'
    return 'other'
  }
  if (ts.isConditionalExpression(expr)) {
    const whenTrue = calleeClass(expr.whenTrue, nonRouteNames)
    const whenFalse = calleeClass(expr.whenFalse, nonRouteNames)
    return whenTrue === 'other' && whenFalse === 'other' ? 'other' : 'route'
  }
  if (ts.isBinaryExpression(expr)) {
    const kind = expr.operatorToken.kind
    if (
      kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const left = calleeClass(expr.left, nonRouteNames)
      const right = calleeClass(expr.right, nonRouteNames)
      return left === 'other' && right === 'other' ? 'other' : 'route'
    }
    return 'other'
  }
  return 'other'
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

function isRouteObjectLike(node) {
  const expr = unwrapExpression(node)
  if (!expr) return false
  if (ts.isObjectLiteralExpression(expr)) return true
  if (!ts.isConditionalExpression(expr)) return false
  return isRouteObjectLike(expr.whenTrue) || isRouteObjectLike(expr.whenFalse)
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

function collectRouteState(node, kind, stateInits) {
  const status = routeOptionsState(node)
  if (status.kind === 'unknown' && kind === 'route') return status
  if (status.kind === 'present') stateInits.push(...status.inits)
  return null
}

/**
 * 预览页里每一次调用都看第二个参数。写了 state 的，不论函数叫什么名字，都按允许名单查键。
 * 参数是展开，一律判红。别名和属性调用（router.navigate、nav.current）认不出带没带状态，也判红。
 * 静态路径认得出是确认页的，仍然只能有一处。路径写成拼接、模板或变量时，只要状态看得见，同样查。
 * 回执原样交还的那一次除外：它不在这里新写键。
 */
function confirmRouteStateAllowed(sourceText) {
  const source = ts.createSourceFile('PrintPreviewPage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nonRouteNames = nonRouteCalleeNames(source)
  let confirmCalls = 0
  let failure = null
  const visit = (node) => {
    if (failure || !ts.isCallExpression(node)) {
      if (!failure) ts.forEachChild(node, visit)
      return
    }
    for (const arg of node.arguments) {
      if (ts.isSpreadElement(arg)) {
        failure = { ok: false, reason: '调用参数是展开，认不出带没带路由状态' }
        return
      }
    }
    const kind = calleeClass(node.expression, nonRouteNames)
    const destination = node.arguments.length > 0 ? staticNavigatePath(node.arguments[0]) : null
    const isConfirm = destination === CONFIRM_PATH
    if (isReturnCarryForward(node, source)) {
      if (isConfirm && kind === 'route') confirmCalls += 1
      ts.forEachChild(node, visit)
      return
    }
    const stateInits = []
    if (node.arguments.length > 1) {
      const blocked = collectRouteState(node.arguments[1], kind, stateInits)
      if (blocked) {
        failure = blocked
        return
      }
    }
    if (node.arguments[0] && isRouteObjectLike(node.arguments[0])) {
      const blocked = collectRouteState(node.arguments[0], kind, stateInits)
      if (blocked) {
        failure = blocked
        return
      }
    }
    if (stateInits.length === 0) {
      if (isConfirm && kind === 'route') failure = { ok: false, reason: 'navigate 没有 state' }
    } else {
      for (const stateInit of stateInits) {
        const allowed = allowStateKeys(stateInit)
        if (!allowed.ok) {
          failure = allowed
          break
        }
      }
    }
    if (!failure && isConfirm && kind === 'route') confirmCalls += 1
    if (!failure) ts.forEachChild(node, visit)
  }
  visit(source)
  if (failure) return failure
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

assertRouteAllowed(
  `  const go = navigate\n  go('/print/confirm', ${allowedState})`,
  '别名只带交接编号',
)
assertRouteAllowed(
  `  const router = { navigate }\n  router.navigate('/print/confirm', ${allowedState})`,
  '属性调用 router.navigate 只带交接编号',
)
assertRouteAllowed(
  `  const nav = { current: navigate }\n  nav.current('/print/confirm', ${allowedState})`,
  '属性调用 nav.current 只带交接编号',
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
  '认不出',
  '别名的第二个参数是变量，认不出带没带状态',
)
assertRouteRejected(
  `  const router = { navigate }\n  const options = ${allowedState}\n  router.navigate('/print/confirm', options)`,
  '认不出',
  '属性调用的第二个参数是变量，认不出带没带状态',
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
