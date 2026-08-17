// ============================================================================
// 门禁：前端 mock / 桩 ↔ 服务端真实返回形状
//
// ── 它挡的是哪一类缺陷 ──────────────────────────────────────────────────────
//
// 「mock 全绿、生产 100% 失败」。实测样本（2026-08-18）：
//
//   kiosk 的 ConsentScope 自己声明了一个**平铺**的 `disclaimerVersion: string`，
//   而服务端 `ContractReviewPublicConsentScope` 返回的是**嵌套**的
//   `disclaimer.version`，根本没有平铺字段。手写 mock 按自己那份错误声明填了
//   `disclaimerVersion: 'v1.0'`，于是三条 mock Playwright 用例长期全绿；
//   走真实后端时 `consentScope.disclaimerVersion` 恒为 undefined，
//   `POST /contract-reviews` 100% 返回 400 VALIDATION_FAILED。
//
// ── 为什么 typecheck 抓不住 ────────────────────────────────────────────────
//
// 因为那份错误的 Interface 和那份错误的 mock **内部完全自洽**。tsc 只校验
// 「mock ↔ 前端自己的类型」，从不校验「前端自己的类型 ↔ 服务端」。同理：
//   - DTO 里大量可选字段 / any / loose type，会让漏字段合法；
//   - 没开 exactOptionalPropertyTypes 时，嵌套结构填不填都合法；
//   - mock 用 `as unknown as T` 断言时，形状检查被整段跳过。
// 三种情况下 mock 都完全合法，但生产必挂。
//
// ── 因此本门禁的锚点是「服务端源文件」，不是共享类型、更不是前端类型 ───────
//
// 每条绑定在 scripts/mock-server-contract-bindings.json 里指明 serverType：
// controller 真实返回的那个类型在 services/api（或 packages/shared）里的声明位置。
// 前端的 clientType 和 mock 只有被比对的份，没有投票权 —— 前端错了就是前端改。
//
// 比对的两侧刻意不对称，这是本门禁与「类型 vs 类型」比对的关键区别：
//   服务端侧：用 TypeScript **类型检查器**解析（能展开 typeof CONST、交叉、
//             泛型实例化，拿到真正会被序列化出去的属性集合）；
//   前端 mock 侧：读 return 对象**字面量的 AST**，即「代码里实际写了哪些 key」，
//             而不是它自称的类型。所以 mock 的类型标注是错的也没用。
//
// 三条断言（任一不满足即红）：
//   1. mock 写出的 key ⊄ 服务端 key   → 「mock 声明了服务端不返回的字段」
//   2. 服务端必返 key ⊄ mock 写出的 key → 「mock 遗漏了服务端必返的字段」
//   3. 前端 clientType 的 key ⊄ 服务端 key → 前端类型自身漂移（第 1 条的根因）
//
// ── 运行 ────────────────────────────────────────────────────────────────────
//   pnpm run verify:mock-server-contract
// 需要 node_modules（用 typescript 的 compiler API），因此排在 pnpm install 之后。
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const bindingsPath = join(repoRoot, 'scripts/mock-server-contract-bindings.json')

/** 展开层数上限。响应体嵌套超过这个深度的，应该拆绑定而不是放宽这里。 */
const MAX_DEPTH = 6

let failures = 0
const failureLabels = []

function check(label, run) {
  try {
    run()
    console.log(`PASS ${label}`)
  } catch (error) {
    failures += 1
    failureLabels.push(label)
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// 服务端侧：用类型检查器把响应类型摊平成 key 路径集合
// ---------------------------------------------------------------------------

/** services/api 是 commonjs + node moduleResolution；packages/shared 走 bundler。 */
function programFor(absFile, flavor) {
  const shared = {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  }
  const options =
    flavor === 'server'
      ? { ...shared, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 }
      : { ...shared, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX }
  return ts.createProgram([absFile], options)
}

/** 这些类型是叶子：不再往下展开，只记录路径本身。 */
function isLeafType(checker, type) {
  const F = ts.TypeFlags
  const leafFlags =
    F.String | F.Number | F.Boolean | F.BigInt | F.StringLiteral | F.NumberLiteral |
    F.BooleanLiteral | F.BigIntLiteral | F.EnumLike | F.ESSymbol | F.UniqueESSymbol |
    F.Void | F.Undefined | F.Null | F.Never | F.NonPrimitive
  if (type.flags & leafFlags) return true
  // 可调用 / 可构造 → 不会出现在 JSON 响应里，当叶子处理。
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return true
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0) return true
  return false
}

function isOpaqueType(type) {
  return !!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
}

/**
 * 若该类型是「纯字符串字面量联合」（如 `'uploaded'`、`'a' | 'b'`），返回取值集合；
 * 否则返回 null（`string` 这类开放类型不参与取值校验）。
 *
 * 用途：mock 写的字符串必须是服务端**可能**返回的取值之一。实测样本：
 * 服务端 `ContractReviewCreatedTask.status` 恒为 `'uploaded'`，
 * 而 kiosk mock 返回 `'queued'` —— 形状一致、tsc 全绿（前端把它放宽成了
 * 完整的 ContractReviewStatus 联合），但那是真实后端在建单时永远不会给的值。
 */
function stringLiteralValuesOf(type) {
  const members = type.isUnion() ? type.types : [type]
  const values = new Set()
  for (const member of members) {
    // null / undefined 允许出现在联合里，不影响「其余成员是字面量」的判断。
    if (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) continue
    if (!(member.flags & ts.TypeFlags.StringLiteral)) return null
    values.add(member.value)
  }
  return values.size > 0 ? values : null
}

/**
 * 把类型摊平成 `Map<path, { optional, opaque }>`。
 *
 * - 数组/元组 → 下钻元素类型，路径加 `[]` 后缀；
 * - 联合类型 → 逐个成员展开；**任一成员里可选的，整体记为可选**
 *   （服务端可能不返回它，因此不能要求 mock 必填）；
 * - any / unknown / index signature → 记 opaque，子树不再要求逐字段一致。
 */
function flattenServerType(checker, type, node, prefix = '', depth = 0, out = new Map()) {
  if (depth > MAX_DEPTH) return out
  if (isOpaqueType(type)) {
    if (prefix) out.set(prefix, { ...(out.get(prefix) ?? { optional: false }), opaque: true })
    return out
  }
  if (type.isUnion()) {
    for (const member of type.types) {
      if (isLeafType(checker, member) || isOpaqueType(member)) continue
      flattenServerType(checker, member, node, prefix, depth, out)
    }
    return out
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const element = checker.getTypeArguments(type)[0]
    if (element && !isLeafType(checker, element)) {
      flattenServerType(checker, element, node, `${prefix}[]`, depth + 1, out)
    }
    return out
  }
  // 有索引签名（Record<string, X>）→ key 集合不可枚举，整段 opaque。
  if (checker.getIndexInfosOfType(type).length > 0) {
    if (prefix) out.set(prefix, { ...(out.get(prefix) ?? { optional: false }), opaque: true })
    return out
  }
  for (const prop of checker.getPropertiesOfType(type)) {
    const path = prefix ? `${prefix}.${prop.name}` : prop.name
    const optional = !!(prop.flags & ts.SymbolFlags.Optional)
    const declaration = prop.valueDeclaration ?? prop.declarations?.[0] ?? node
    const propType = checker.getTypeOfSymbolAtLocation(prop, declaration)
    const previous = out.get(path)
    const literals = stringLiteralValuesOf(propType)
    out.set(path, {
      // 联合展开时，只要有一个成员把它标成可选，整体就算可选。
      optional: previous ? previous.optional || optional : optional,
      opaque: previous?.opaque ?? false,
      // 同理，联合展开时取值集合取并集。任一成员是开放 string → 整体不校验取值。
      literals: previous
        ? previous.literals && literals
          ? new Set([...previous.literals, ...literals])
          : null
        : literals,
    })
    if (!isLeafType(checker, propType)) {
      flattenServerType(checker, propType, declaration, path, depth + 1, out)
    }
  }
  return out
}

function resolveExportedType(program, absFile, typeName, bindingId) {
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(absFile)
  assert.ok(sourceFile, `[${bindingId}] 读不到源文件：${absFile}`)
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  assert.ok(moduleSymbol, `[${bindingId}] ${absFile} 不是模块（没有任何 export）`)
  const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === typeName)
  assert.ok(symbol, `[${bindingId}] ${absFile} 没有导出类型 ${typeName}`)
  const type = checker.getDeclaredTypeOfSymbol(symbol)
  const flattened = flattenServerType(checker, type, sourceFile)
  assert.ok(
    flattened.size > 0,
    `[${bindingId}] ${typeName} 解析出 0 个字段 —— 大概率是 import 没解析成功，` +
      `此时门禁会退化成恒真，必须先修好再继续`,
  )
  return flattened
}

// ---------------------------------------------------------------------------
// mock 侧：读 return 对象字面量的 AST（「代码里实际写了哪些 key」）
// ---------------------------------------------------------------------------

function parseSource(absFile) {
  return ts.createSourceFile(
    absFile,
    readFileSync(absFile, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
    absFile.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

/**
 * 找到 mock 的声明。支持三种写法：
 *   - `function mockX() { return {...} }` / `const mockX = () => ({...})` → 返回函数节点
 *   - `const DEMO_X: T = {...}`（常量形态的 mock）→ 直接返回对象字面量
 *   - `const STUB = [...].map((k) => ({...}))`（由 key 列表铺开的行桩）→ 取 map 回调
 *     返回的那一行字面量。Playwright 夹具常用这个形状（见 #692 的能力端点桩）。
 */
function findMockDeclaration(sourceFile, name) {
  let found = null
  const visit = (node) => {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = { kind: 'function', node }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      const initializer = node.initializer ? stripParens(node.initializer) : null
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        found = { kind: 'function', node: initializer }
      } else if (initializer && ts.isObjectLiteralExpression(initializer)) {
        found = { kind: 'literal', node: initializer }
      } else if (initializer) {
        const callback = mapCallbackOf(initializer)
        if (callback) found = { kind: 'function', node: callback }
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return found
}

/** `<任意表达式>.map(fn)` → fn（只认单参回调，认不出返回 null 让上层显式报错）。 */
function mapCallbackOf(expression) {
  if (!ts.isCallExpression(expression)) return null
  const callee = expression.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'map') return null
  const callback = expression.arguments[0] ? stripParens(expression.arguments[0]) : null
  if (!callback) return null
  return ts.isArrowFunction(callback) || ts.isFunctionExpression(callback) ? callback : null
}

/** 收集函数体里所有 return 的对象字面量（不含内层嵌套函数的 return）。 */
function returnedObjectLiterals(fn) {
  const literals = []
  if (fn.body && !ts.isBlock(fn.body)) {
    const expression = stripParens(fn.body)
    if (ts.isObjectLiteralExpression(expression)) literals.push(expression)
    return literals
  }
  const visit = (node) => {
    if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) {
      return
    }
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = stripParens(node.expression)
      if (ts.isObjectLiteralExpression(expression)) literals.push(expression)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return literals
}

function stripParens(node) {
  let current = node
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}

/**
 * 把对象字面量摊平成 key 路径集合。
 *
 * 返回 `Map<path, 字符串字面量取值 | undefined>`：值只在 mock 直接写了字符串
 * 字面量时才有，用于和服务端的字面量联合比对。
 *
 * spread（`...base`）会让「写了哪些 key」无法静态判定 —— 直接抛错而不是放行，
 * 否则门禁会在遇到 spread 时静默退化成恒真，这正是本门禁要消灭的失败模式。
 */
function flattenLiteral(literal, bindingId, prefix = '', depth = 0, out = new Map()) {
  if (depth > MAX_DEPTH) return out
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      throw new Error(
        `[${bindingId}] mock 在 ${prefix || '<root>'} 处使用了 spread，key 集合无法静态判定；` +
          `请把字段逐条写出，或把该路径登记为 opaquePaths`,
      )
    }
    const nameNode = property.name
    if (!nameNode) continue
    let key = null
    if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) key = nameNode.text
    else if (ts.isNumericLiteral(nameNode)) key = nameNode.text
    if (key === null) {
      throw new Error(`[${bindingId}] mock 在 ${prefix || '<root>'} 处使用了计算属性名，无法静态判定`)
    }
    const path = prefix ? `${prefix}.${key}` : key
    if (!ts.isPropertyAssignment(property)) {
      out.set(path, undefined)
      continue
    }
    const value = stripParens(property.initializer)
    out.set(path, ts.isStringLiteralLike(value) ? value.text : undefined)
    if (ts.isObjectLiteralExpression(value)) {
      flattenLiteral(value, bindingId, path, depth + 1, out)
    } else if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements) {
        const item = stripParens(element)
        if (ts.isObjectLiteralExpression(item)) flattenLiteral(item, bindingId, `${path}[]`, depth + 1, out)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 比对
// ---------------------------------------------------------------------------

/** 某路径的祖先是否被判为 opaque（any / Record / 显式登记）→ 子树不参与比对。 */
function underOpaque(path, opaqueRoots) {
  for (const root of opaqueRoots) {
    if (path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[]`)) return true
  }
  return false
}

function opaqueRootsOf(serverShape, extra) {
  const roots = new Set(extra ?? [])
  for (const [path, meta] of serverShape) if (meta.opaque) roots.add(path)
  return roots
}

function assertNoExtraKeys(actualPaths, serverShape, opaqueRoots, bindingId, sideLabel) {
  const extras = [...actualPaths]
    .filter((path) => !underOpaque(path, opaqueRoots))
    .filter((path) => !serverShape.has(path))
    .sort()
  assert.deepEqual(
    extras,
    [],
    `[${bindingId}] ${sideLabel} 声明了服务端不返回的字段：${extras.join(', ')}\n` +
      `  这些字段在 http 模式下恒为 undefined。服务端真实字段集合见 ` +
      `${bindingId} 绑定里的 serverType。`,
  )
}

function assertNoMissingRequired(actualPaths, serverShape, opaqueRoots, bindingId, allowMissing) {
  const allowed = new Set(allowMissing ?? [])
  const missing = [...serverShape.entries()]
    .filter(([, meta]) => !meta.optional && !meta.opaque)
    .map(([path]) => path)
    .filter((path) => !underOpaque(path, opaqueRoots))
    .filter((path) => !allowed.has(path))
    // 数组元素字段只有在 mock 至少写了一个元素时才要求；空数组是合法 mock。
    .filter((path) => !path.includes('[]') || [...actualPaths].some((p) => p.startsWith(path.split('[]')[0] + '[]')))
    .filter((path) => !actualPaths.has(path))
    .sort()
  assert.deepEqual(
    missing,
    [],
    `[${bindingId}] mock 遗漏了服务端必返的字段：${missing.join(', ')}\n` +
      `  mock 少写一个字段，就等于这条链路上「真实响应有、mock 没有」的分支从未被跑过。`,
  )
}

function assertLiteralValuesReachable(mockValues, serverShape, opaqueRoots, bindingId, mockLabel) {
  const offenders = []
  for (const [path, value] of mockValues) {
    if (value === undefined) continue
    if (underOpaque(path, opaqueRoots)) continue
    const meta = serverShape.get(path)
    if (!meta?.literals) continue
    if (!meta.literals.has(value)) {
      offenders.push(`${path}='${value}'（服务端只可能是 ${[...meta.literals].map((v) => `'${v}'`).join(' | ')}）`)
    }
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    `[${bindingId}] mock ${mockLabel} 写了服务端不可能返回的取值：${offenders.join('；')}\n` +
      `  形状对得上、tsc 也全绿，但这条分支在真实后端永远走不到。`,
  )
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const bindings = JSON.parse(readFileSync(bindingsPath, 'utf8'))
assert.ok(Array.isArray(bindings.enforced), 'bindings.enforced 必须是数组')
assert.ok(Array.isArray(bindings.deferred), 'bindings.deferred 必须是数组')

// 强制车道：资损 / 隐私 / AI / 硬件能力四条。其余登记进 deferred。
//
// device 这条是 #692 合入后补的：终端能力端点决定「彩色 / 双面要不要放给用户点」，
// 桩漂移的后果是机端把一台没验过的机器的能力开出去 —— 用户付完钱印不出来，
// 落回资损。#692 自己的定位也是「fail-closed 真机验证闸门」。
const ENFORCED_LANES = new Set(['payment', 'privacy', 'ai', 'device'])

check('绑定清单自身合法', () => {
  assert.ok(bindings.enforced.length > 0, 'enforced 不得为空')
  const ids = new Set()
  for (const binding of bindings.enforced) {
    assert.ok(binding.id, '每条绑定必须有 id')
    assert.ok(!ids.has(binding.id), `绑定 id 重复：${binding.id}`)
    ids.add(binding.id)
    assert.ok(
      ENFORCED_LANES.has(binding.lane),
      `[${binding.id}] lane=${binding.lane} 不在强制车道 ${[...ENFORCED_LANES].join('/')} 内；` +
        `非强制车道请登记到 deferred`,
    )
    assert.ok(binding.serverType?.file && binding.serverType?.name, `[${binding.id}] serverType 不完整`)
  }
  for (const item of bindings.deferred) {
    assert.ok(item.id && item.reason, 'deferred 每条必须写 id 和 reason')
    assert.ok(item.reason.length >= 20, `[${item.id}] deferred 的 reason 太短，必须写清为什么本轮不强制`)
  }
})

for (const binding of bindings.enforced) {
  const serverAbs = join(repoRoot, binding.serverType.file)
  const serverFlavor = binding.serverType.file.startsWith('services/api/') ? 'server' : 'client'

  let serverShape = null
  check(`${binding.id} · 服务端形状可解析`, () => {
    serverShape = resolveExportedType(
      programFor(serverAbs, serverFlavor),
      serverAbs,
      binding.serverType.name,
      binding.id,
    )
  })
  if (!serverShape) continue

  const opaqueRoots = opaqueRootsOf(serverShape, binding.opaquePaths)

  if (binding.clientType) {
    check(`${binding.id} · 前端类型不得多出服务端没有的字段`, () => {
      const clientAbs = join(repoRoot, binding.clientType.file)
      const clientShape = resolveExportedType(
        programFor(clientAbs, 'client'),
        clientAbs,
        binding.clientType.name,
        binding.id,
      )
      assertNoExtraKeys(
        new Set(clientShape.keys()),
        serverShape,
        opaqueRoots,
        binding.id,
        `前端类型 ${binding.clientType.name}（${relative(repoRoot, clientAbs)}）`,
      )
    })
  }

  for (const mock of binding.mocks ?? []) {
    const mockAbs = join(repoRoot, mock.file)
    check(`${binding.id} · mock ${mock.fn} 形状与服务端一致`, () => {
      const sourceFile = parseSource(mockAbs)
      const declaration = findMockDeclaration(sourceFile, mock.fn)
      assert.ok(declaration, `[${binding.id}] ${mock.file} 里找不到 ${mock.fn}`)
      const literals =
        declaration.kind === 'literal' ? [declaration.node] : returnedObjectLiterals(declaration.node)
      assert.ok(
        literals.length > 0,
        `[${binding.id}] ${mock.fn} 没有直接 return 对象字面量 —— 门禁读不到它写了哪些 key，` +
          `无法判定，请改成直接返回字面量`,
      )
      for (const [index, literal] of literals.entries()) {
        const label = literals.length > 1 ? `${mock.fn}#return${index + 1}` : mock.fn
        const values = flattenLiteral(literal, binding.id)
        const paths = new Set(values.keys())
        assertNoExtraKeys(paths, serverShape, opaqueRoots, binding.id, `mock ${label}`)
        assertNoMissingRequired(paths, serverShape, opaqueRoots, binding.id, binding.optionalOnServer)
        assertLiteralValuesReachable(values, serverShape, opaqueRoots, binding.id, label)
      }
    })
  }
}

console.log('')
console.log(
  `绑定：强制 ${bindings.enforced.length} 条 / 登记待办 ${bindings.deferred.length} 条` +
    `（待办口径见 scripts/mock-server-contract-bindings.json）`,
)

if (failures > 0) {
  console.error(`\nFAILED ${failures} 项：${failureLabels.join('；')}`)
  process.exit(1)
}
console.log('PASS mock ↔ server contract')
