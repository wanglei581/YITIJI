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

function navigateCalleeNames(source) {
  const names = new Set()
  const visit = (node) => {
    const init = ts.isVariableDeclaration(node) ? unwrapExpression(node.initializer) : null
    if (
      init &&
      ts.isIdentifier(node.name) &&
      ts.isCallExpression(init) &&
      ts.isIdentifier(init.expression) &&
      init.expression.text === 'useNavigate'
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (names.size === 0) names.add('navigate')
  return names
}

/** 对象字面量里的 state 初值。展开、简写、计算属性读不出，按失败关闭。 */
function routeStateInitializer(node, label) {
  const expr = unwrapExpression(node)
  if (!expr || !ts.isObjectLiteralExpression(expr)) {
    return { ok: false, reason: `${label}不是对象字面量` }
  }
  let stateInit = null
  let sawState = false
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || ts.isComputedPropertyName(prop.name)) {
      return { ok: false, reason: `${label}含有展开、简写或计算属性` }
    }
    if (propertyName(prop.name) === 'state') {
      sawState = true
      stateInit = prop.initializer
    }
  }
  return { ok: true, sawState, stateInit }
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
 * 预览页里任何带路由状态的跳转都按允许名单查键，不管路径写成字符串、模板、拼接还是变量。
 * 静态认得出是确认页的，仍然只能有一处。认不出目标页、又带了状态的，按去确认页查同一份名单。
 * 回执原样交还的那一次除外：它不在这里新写键。
 */
function confirmRouteStateAllowed(sourceText) {
  const source = ts.createSourceFile('PrintPreviewPage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = navigateCalleeNames(source)
  const calls = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) {
      calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  let confirmCalls = 0
  for (const call of calls) {
    const destination = staticNavigatePath(call.arguments[0])
    const isConfirm = destination === CONFIRM_PATH
    if (isConfirm) confirmCalls += 1
    if (isReturnCarryForward(call, source)) continue

    const stateInits = []
    if (call.arguments[1]) {
      const options = routeStateInitializer(call.arguments[1], 'navigate 的第二参')
      if (!options.ok) return options
      if (options.sawState) stateInits.push(options.stateInit)
    }
    const target = unwrapExpression(call.arguments[0])
    if (target && ts.isObjectLiteralExpression(target)) {
      const located = routeStateInitializer(target, 'navigate 的目标')
      if (!located.ok) return located
      if (located.sawState) stateInits.push(located.stateInit)
    }
    if (stateInits.length === 0) {
      if (isConfirm) return { ok: false, reason: 'navigate 没有 state' }
      continue
    }
    for (const stateInit of stateInits) {
      const allowed = allowStateKeys(stateInit)
      if (!allowed.ok) return allowed
    }
  }
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

console.log('\nALL PASS')
