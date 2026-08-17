/**
 * 会花钱的 AI 路由：限流维度必须显式声明。
 *
 * 为什么是派生式而不是清单式
 * ---------------------------------------------------------------------------
 * 仓里已经有多条门禁因为硬编码白名单而防不住新增：清单是人维护的，新增路由的人
 * 忘了加一行，门禁不会报错、不会提示，只是不管 —— 「门禁存在 ≠ 门禁在管」。
 *
 * 所以这条门禁不写路由清单。它用 TypeScript TypeChecker 建**调用图**，从「真正
 * 向外部厂商发请求、按次计费」的 sink 函数反向可达性推导出「哪些 controller
 * handler 会花钱」，再要求这些 handler 每一条都显式声明限流维度。
 *
 * 于是新增一条调 LLM 的路由**不需要有人记得来改这个文件**：调用图里它自然可达，
 * 没写维度就是 CI 红。
 *
 * 为什么「显式声明」必须包含 IP 那一档
 * ---------------------------------------------------------------------------
 * 纯 IP 有时候就是正确答案（凭证爆破类路由必须锚在 IP 上，见 IpScopedThrottle
 * 的注释）。但如果「按 IP」用「什么都不写」表示，那么「想过了，IP 是对的」和
 * 「忘了想」在代码里完全一样，门禁也就无从区分。所以两档都要显式：
 *
 *   @TerminalScopedThrottle(n)      —— 按客户端（IP + 终端/会话）
 *   @IpScopedThrottle(n, '理由')     —— 按纯 IP，且必须写明为什么
 *
 * 五层断言
 * ---------------------------------------------------------------------------
 *   A. sink 契约：声明的 sink 文件必须仍然含有出站请求（重构搬走即红，防止调用图
 *      悄悄断链导致「可达集合变空 → 全绿」这种最危险的假绿）。
 *   B. 派生覆盖：所有可达 sink 的 controller handler 必须显式声明维度，且只声明一次。
 *   C. 新厂商守卫：AI 相关目录下任何发起出站请求的文件，必须已登记为 sink 文件 ——
 *      接入新厂商（换模型、加 TTS）时强制回来更新 sink 契约。
 *   D. 天花板元数据：@PaidAiThrottle 必须真的写下 ai-ip 的 limit 元数据 ——
 *      这个字符串约定一旦失效，skipIf 会永远跳过，花费天花板**静默**消失。
 *   E. 运行时行为：真起 Nest + 真 HTTP，证明每客户端额度、每 IP 每小时天花板
 *      都真实生效，且未声明的路由确实被 skipIf 跳过、不被误伤。
 *
 * 不连数据库、不连 Redis、不调用任何外部服务。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import 'reflect-metadata'
import ts from 'typescript'
import { AI_IP_LIMIT_METADATA_KEY, PaidAiThrottle } from '../src/common/throttler/terminal-throttle'

const API_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(API_ROOT, 'src')

// ---------------------------------------------------------------------------
// A. sink 契约：真正按次计费的外部调用
// ---------------------------------------------------------------------------
// 这是本门禁**唯一**的人工清单，粒度是「厂商集成文件」而不是「路由」，也不是
// 「函数名」：sink 函数由「这个文件里哪个函数发出站请求」**推导**出来，
// 因此改方法名、拆私有方法都不会让调用图悄悄断链。
//
// 历史教训：#699 之前每个能力各自 fetch 自己的 /chat/completions，这里曾登记 13 个文件；
// #699 把它们集中进 llm-http.ts 之后，那 13 条登记**全部失效** —— 断言 A 当场报红
// 并指出「登记的 sink 里已经没有出站请求」，而不是让可达集合悄悄变空后全绿。
// 这正是 sink 契约存在的理由：重构会发生，静默失效不能发生。
const SINK_FILES = [
  // #699 起，全部 LLM 调用集中到这里（llmFetchJson：超时 + 并发闸门）。
  'src/ai/llm/llm-http.ts',
  // 以下厂商没有走 llm-http，各自直连，需单独登记。
  'src/ai/resume/ocr/baidu-ocr.provider.ts',
  'src/asr/asr.service.ts',
  'src/mock-interview/asr/tts.service.ts',
  'src/job-ai/job-quality.service.ts',
  // 合同审查自带 provider transport（fetchImpl 默认取全局 fetch），同样按次计费。
  'src/contract-review/contract-review-provider.service.ts',
] as const

// 出站请求扫描范围（断言 C）。这些目录里出现新的 fetch/axios 即视为可能接入了
// 新厂商，必须回来把它登记进 SINK_FILES 或显式登记为豁免。
const VENDOR_SCAN_DIRS = [
  'src/ai',
  'src/asr',
  'src/job-ai',
  'src/advisor',
  'src/contract-review',
  'src/materials',
  'src/mock-interview',
]

// 断言 C 的已知豁免：确实发出站请求，但不是「按次计费的模型调用」。
const VENDOR_SCAN_EXEMPT = new Set<string>([
  // 测试夹具自己起 HTTP server 打自己，不触达任何厂商。
  'src/contract-review/__tests__/contract-review-http-controller.test.ts',
])

const DIMENSION_DECORATORS = ['PaidAiThrottle', 'TerminalScopedThrottle', 'IpScopedThrottle']
const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All'])

type FnNode = ts.MethodDeclaration | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction

function isFnNode(node: ts.Node): node is FnNode {
  return (
    ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  )
}

function nodeId(node: ts.Node): string {
  return `${node.getSourceFile().fileName}#${String(node.pos)}`
}

function rel(fileName: string): string {
  return path.relative(API_ROOT, fileName).split(path.sep).join('/')
}

/**
 * 把一个调用归属到「最近的具名函数」。
 *
 * 箭头函数 / 函数表达式（回调、Promise 链、map 里的 lambda）不单独成节点，
 * 而是算进它所在的方法 —— 否则 `items.map(x => this.llm.chat(x))` 会因为
 * sink 挂在匿名箭头上而在反向可达里断掉，属于典型假绿。
 */
function enclosingNamedFn(node: ts.Node): FnNode | null {
  let current: ts.Node | undefined = node.parent
  let fallback: FnNode | null = null
  while (current) {
    if (isFnNode(current)) {
      if (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) return current
      fallback ??= current
    }
    current = current.parent
  }
  return fallback
}

/**
 * 出站请求点：对全局 `fetch` / `axios` 的**值引用**。
 *
 * 刻意不只匹配 `fetch(...)` 这种直接调用 —— #699 把 LLM 调用集中到
 * `llmFetchJson` 之后，真正的出站是 `const doFetch = options.fetchImpl ?? fetch`
 * 再 `doFetch(...)`，只认调用表达式会**整个漏掉**这个唯一的 LLM 出口。
 *
 * 排除类型位置（`typeof fetch`、类型引用）：那里出现的 fetch 不发请求。
 * AST 判定，不会命中注释或字符串。
 */
function isOutboundRef(node: ts.Node): boolean {
  if (!ts.isIdentifier(node)) return false
  if (node.text !== 'fetch' && node.text !== 'axios') return false
  const parent = node.parent
  // 属性名（obj.fetch）不算：那是别人的方法，不是全局出站入口。
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) return false
  // 类型位置：typeof fetch / 类型引用。
  let cursor: ts.Node | undefined = parent
  while (cursor) {
    if (ts.isTypeQueryNode(cursor) || ts.isTypeReferenceNode(cursor) || ts.isTypeNode(cursor)) {
      return false
    }
    if (isFnNode(cursor) || ts.isSourceFile(cursor)) break
    cursor = cursor.parent
  }
  return true
}

function decoratorNames(node: ts.Node): string[] {
  return (ts.getDecorators(node as ts.HasDecorators) ?? []).map((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression
    return ts.isIdentifier(expression) ? expression.text : ''
  })
}

function isControllerClass(node: ts.ClassDeclaration): boolean {
  return decoratorNames(node).includes('Controller')
}

function httpVerbOf(node: ts.MethodDeclaration): string | null {
  for (const name of decoratorNames(node)) {
    if (HTTP_METHOD_DECORATORS.has(name)) return name
  }
  return null
}

interface Handler {
  file: string
  line: number
  cls: string
  method: string
  verb: string
  node: ts.MethodDeclaration
}

function main(): void {
  console.log('=== 会花钱的 AI 路由：限流维度显式声明验证 ===')

  const configPath = path.join(API_ROOT, 'tsconfig.json')
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    },
  })
  assert.ok(parsed, 'tsconfig.json 解析失败')

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
  const checker = program.getTypeChecker()
  const sourceFiles = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && sf.fileName.startsWith(SRC_ROOT))

  // ── 接口实现索引 ─────────────────────────────────────────────────────
  // 关键：AiService 持有的是 `private readonly provider: AiProvider`（**接口**）。
  // `this.provider.parseResume()` 的符号解析落在接口的 MethodSignature 上，
  // 而 MethodSignature 不是函数体，直接丢弃会让调用图在这里断掉 ——
  // 第一版就是因此只推导出 3 条路由。这里按 `implements` 子句把接口方法
  // 连到所有实现类的同名方法上，补回动态分发这条边。
  const implsByInterface = new Map<string, ts.ClassDeclaration[]>()
  for (const sf of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        for (const heritage of node.heritageClauses ?? []) {
          if (heritage.token !== ts.SyntaxKind.ImplementsKeyword) continue
          for (const type of heritage.types) {
            if (!ts.isIdentifier(type.expression)) continue
            const list = implsByInterface.get(type.expression.text) ?? []
            list.push(node)
            implsByInterface.set(type.expression.text, list)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  // ── 建调用图 ──────────────────────────────────────────────────────────
  const callers = new Map<string, Set<string>>() // callee id -> caller ids
  const handlers: Handler[] = []

  const addEdge = (calleeId: string, callerId: string): void => {
    let set = callers.get(calleeId)
    if (!set) {
      set = new Set<string>()
      callers.set(calleeId, set)
    }
    set.add(callerId)
  }

  for (const sf of sourceFiles) {
    const visit = (node: ts.Node): void => {

      if (ts.isClassDeclaration(node) && isControllerClass(node)) {
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue
          const verb = httpVerbOf(member)
          if (!verb) continue
          handlers.push({
            file: rel(sf.fileName),
            line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
            cls: node.name?.text ?? '(anonymous)',
            method: member.name.text,
            verb,
            node: member,
          })
        }
      }

      if (ts.isCallExpression(node)) {
        const target = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name
          : node.expression
        let symbol = checker.getSymbolAtLocation(target)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        const caller = enclosingNamedFn(node)
        if (symbol && caller) {
          for (const decl of symbol.getDeclarations() ?? []) {
            if (isFnNode(decl)) {
              addEdge(nodeId(decl), nodeId(caller))
              continue
            }
            // 接口/抽象方法：连到所有实现类的同名方法（动态分发补边）。
            if (ts.isMethodSignature(decl) && ts.isIdentifier(decl.name)) {
              const iface = decl.parent
              if (!ts.isInterfaceDeclaration(iface)) continue
              const methodName = decl.name.text
              for (const impl of implsByInterface.get(iface.name.text) ?? []) {
                for (const member of impl.members) {
                  if (
                    ts.isMethodDeclaration(member) &&
                    ts.isIdentifier(member.name) &&
                    member.name.text === methodName
                  ) {
                    addEdge(nodeId(member), nodeId(caller))
                  }
                }
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  // ── 断言 A：sink 契约 ────────────────────────────────────────────────
  // sink 函数 = 登记文件里「包含出站请求的那个函数」，由 AST 推导，不写函数名。
  const sinkIds: string[] = []
  const sinkFailures: string[] = []
  for (const sinkFile of SINK_FILES) {
    const sf = sourceFiles.find((f) => rel(f.fileName) === sinkFile)
    if (!sf) {
      sinkFailures.push(`${sinkFile}: 登记的 sink 文件不存在（被移动或删除？）`)
      continue
    }
    const before = sinkIds.length
    const visit = (node: ts.Node): void => {
      if (isOutboundRef(node)) {
        const owner = enclosingNamedFn(node)
        if (owner) {
          sinkIds.push(nodeId(owner))
        } else {
          // 出站引用不在任何具名函数里 —— 典型是构造函数默认参数
          // （`private readonly fetchImpl: FetchLike = fetch`）或类属性初始化。
          // 这时真正发请求的是该类的某个方法，静态上无法确定是哪个，
          // 于是把**整个类的方法**都算作 sink：宁可多算，也不能漏算
          // （漏算 = 这条花钱路径在门禁里隐身）。
          let cursor: ts.Node | undefined = node.parent
          while (cursor && !ts.isClassDeclaration(cursor)) cursor = cursor.parent
          if (cursor && ts.isClassDeclaration(cursor)) {
            for (const member of cursor.members) {
              if (ts.isMethodDeclaration(member)) sinkIds.push(nodeId(member))
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    if (sinkIds.length === before) {
      sinkFailures.push(
        `${sinkFile}: 登记为按次计费 sink，但文件里已经找不到出站请求。` +
          '如果调用被搬走了，请把 SINK_FILES 指向新位置 —— ' +
          'sink 断链会让可达集合变小、门禁「变绿」，这是最危险的假绿，故此处直接判红',
      )
    }
  }
  assert.deepEqual(sinkFailures, [], `sink 契约失败:\n${sinkFailures.join('\n')}`)
  console.log(
    `  PASS A. sink 契约：${String(SINK_FILES.length)} 个厂商集成文件，推导出 ${String(sinkIds.length)} 个按次计费调用点`,
  )

  // ── 反向可达 ─────────────────────────────────────────────────────────
  const reachable = new Set<string>(sinkIds)
  const queue = [...sinkIds]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined) break
    for (const caller of callers.get(current) ?? []) {
      if (!reachable.has(caller)) {
        reachable.add(caller)
        queue.push(caller)
      }
    }
  }

  const paidHandlers = handlers.filter((h) => reachable.has(nodeId(h.node)))
  assert.ok(
    paidHandlers.length > 0,
    '派生出的「会花钱的路由」为空 —— 调用图一定是断了，不可能一条都没有',
  )
  console.log(
    `  PASS B0. 调用图派生出 ${String(paidHandlers.length)} 条会花钱的 AI 路由（共扫描 ${String(handlers.length)} 条 HTTP 路由）`,
  )

  // AI_THROTTLE_REPORT=1 时打印派生结果，便于人工复核「推导出的集合对不对」。
  if (process.env['AI_THROTTLE_REPORT']) {
    console.log('  --- 派生出的会花钱路由 ---')
    for (const h of [...paidHandlers].sort((a, b) => a.file.localeCompare(b.file))) {
      const dims = decoratorNames(h.node).filter((n) => DIMENSION_DECORATORS.includes(n))
      console.log(`    ${dims.length > 0 ? dims.join('+') : '(未声明)'}  ${h.file}:${String(h.line)} ${h.cls}.${h.method}`)
    }
  }

  // ── 断言 B：每条派生出的路由必须显式声明维度，且只声明一次 ─────────────
  const failures: string[] = []
  for (const handler of paidHandlers) {
    const names = decoratorNames(handler.node).filter((n) => DIMENSION_DECORATORS.includes(n))
    if (names.length === 0) {
      failures.push(
        `${handler.file}:${String(handler.line)} ${handler.cls}.${handler.method} (@${handler.verb}): ` +
          '这条路由会调用按次计费的外部 AI，必须显式声明限流维度 —— ' +
          '@TerminalScopedThrottle(n) 按客户端，或 @IpScopedThrottle(n, 理由) 按纯 IP。' +
          '不写维度时它落进按 IP 计数的公共桶，一个大厅的 N 台机器会共用一份额度',
      )
    } else if (names.length > 1) {
      failures.push(
        `${handler.file}:${String(handler.line)} ${handler.cls}.${handler.method}: ` +
          `同时声明了 ${names.join(' 与 ')}，维度只能有一个`,
      )
    }
  }
  assert.deepEqual(failures, [], `AI 限流维度派生覆盖失败:\n${failures.join('\n')}`)
  console.log(`  PASS B. 派生覆盖：${String(paidHandlers.length)} 条会花钱的路由全部显式声明了维度`)

  // ── 断言 C：新厂商守卫 ───────────────────────────────────────────────
  const sinkFileSet = new Set<string>(SINK_FILES)
  const vendorFailures: string[] = []
  for (const sf of sourceFiles) {
    const relPath = rel(sf.fileName)
    if (!VENDOR_SCAN_DIRS.some((dir) => relPath.startsWith(`${dir}/`))) continue
    if (sinkFileSet.has(relPath) || VENDOR_SCAN_EXEMPT.has(relPath)) continue
    let hasOutbound = false
    const visit = (node: ts.Node): void => {
      if (!hasOutbound && isOutboundRef(node)) hasOutbound = true
      if (!hasOutbound) ts.forEachChild(node, visit)
    }
    visit(sf)
    if (hasOutbound) {
      vendorFailures.push(
        `${relPath}: AI 相关目录下出现出站请求，但未登记为按次计费 sink。` +
          '如果它是新的模型/语音/OCR 厂商，请加进 SINK_FILES（否则经它花钱的路由不会被本门禁覆盖）；' +
          '如果它不按次计费，请加进 VENDOR_SCAN_EXEMPT 并写明理由',
      )
    }
  }
  assert.deepEqual(vendorFailures, [], `新厂商守卫失败:\n${vendorFailures.join('\n')}`)
  console.log(`  PASS C. 新厂商守卫：${String(VENDOR_SCAN_DIRS.length)} 个 AI 目录下没有未登记的出站调用`)

  // ── 断言 D：花费天花板真的挂上了（不是只写了个名字）─────────────────
  // ai-ip 桶靠 skipIf 只对声明过的路由生效，判据是一个**字符串约定**的元数据键。
  // 约定一旦失效，skipIf 会「永远跳过」，天花板静默消失 —— 从行为上看不出来，
  // 所以这里真的调用一次装饰器、真的读一次元数据来证明它写下了。
  class CeilingProbe {
    probe(): void {
      /* 被装饰的探针方法 */
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(CeilingProbe.prototype, 'probe')
  assert.ok(descriptor, '探针方法缺失')
  PaidAiThrottle(1, 1)(CeilingProbe.prototype, 'probe', descriptor)
  const reflectApi = Reflect as unknown as { getMetadata?: (k: string, t: object) => unknown }
  assert.equal(
    typeof reflectApi.getMetadata,
    'function',
    'reflect-metadata 未加载，ai-ip 天花板的 skipIf 判据会永远为真（天花板静默失效）',
  )
  const written = reflectApi.getMetadata?.(AI_IP_LIMIT_METADATA_KEY, CeilingProbe.prototype.probe)
  assert.equal(
    written,
    1,
    `@PaidAiThrottle 没有写下元数据键 ${AI_IP_LIMIT_METADATA_KEY} —— ` +
      'skipIf 会永远跳过 ai-ip 桶，每 IP 每小时的花费天花板静默失效。' +
      '多半是 @nestjs/throttler 改了内部常量命名，需同步 AI_IP_LIMIT_METADATA_KEY',
  )
  console.log('  PASS D. 花费天花板：@PaidAiThrottle 确实写下了 ai-ip 元数据，skipIf 判据有效')

  const paidAiRoutes = paidHandlers.filter((h) =>
    decoratorNames(h.node).includes('PaidAiThrottle'),
  ).length
  console.log(
    `  PASS: 静态部分完成（${String(paidAiRoutes)} 条挂了每 IP 每小时花费天花板）`,
  )
}

/**
 * 断言 E：花费天花板的**运行时行为**。
 *
 * 断言 D 只证明「元数据写下了」。天花板真正生效还依赖 skipIf 两个方向都对：
 *   - 声明过的路由必须**被计数**（否则成本上限形同虚设）；
 *   - 没声明的路由必须**被跳过**（否则 400+ 条普通路由会被一个每小时的桶误伤，
 *     那是把成本防线变成线上事故）。
 * 这两件事只能真跑 HTTP 才看得出来，所以这里起一个真实 Nest 应用。
 */
async function verifyCeilingRuntime(): Promise<void> {
  const PER_CLIENT = 2
  const IP_HOURLY = 5

  const { Controller, Get } = await import('@nestjs/common')
  const { APP_GUARD, NestFactory } = await import('@nestjs/core')
  const { ThrottlerGuard, ThrottlerModule } = await import('@nestjs/throttler')
  const { buildThrottlerConfig, TerminalScopedThrottle } = await import(
    '../src/common/throttler/terminal-throttle'
  )

  @Controller('probe')
  class ProbeController {
    @Get('paid')
    @PaidAiThrottle(PER_CLIENT, IP_HOURLY)
    paid(): { ok: true } {
      return { ok: true }
    }

    /** 没声明 ai-ip 的普通按客户端路由：必须完全不受每小时天花板影响。 */
    @Get('unpaid')
    @TerminalScopedThrottle(PER_CLIENT)
    unpaid(): { ok: true } {
      return { ok: true }
    }
  }

  const { Module } = await import('@nestjs/common')
  @Module({
    imports: [ThrottlerModule.forRoot(buildThrottlerConfig())],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  })
  class ProbeModule {}

  const app = await NestFactory.create(ProbeModule, { logger: false })
  try {
    await app.listen(0, '127.0.0.1')
    const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1')

    const hit = async (route: string, client: string): Promise<number> => {
      const res = await fetch(`${baseUrl}/probe/${route}`, { headers: { 'X-Terminal-Id': client } })
      await res.text()
      return res.status
    }

    // 每客户端桶仍然生效（换客户端就有新额度）。
    for (const client of ['t1', 't2']) {
      for (let i = 0; i < PER_CLIENT; i += 1) {
        assert.equal(await hit('paid', client), 200, `客户端 ${client} 的第 ${String(i + 1)} 次应放行`)
      }
      assert.equal(await hit('paid', client), 429, `客户端 ${client} 超出每分钟额度应 429`)
    }
    console.log('  PASS E1. 付费路由：同 IP 不同客户端各有独立的每分钟额度')

    // 已消耗 4 次成功（2 客户端 × 2）。继续换全新客户端，第 5 次成功后天花板必须落下。
    assert.equal(await hit('paid', 'fresh-1'), 200, '第 5 次（仍在每小时天花板内）应放行')
    const blocked = await hit('paid', 'fresh-2')
    assert.equal(
      blocked,
      429,
      '超出每 IP 每小时天花板后，即使换全新客户端标识也必须被拦 —— ' +
        '否则换请求头就能无限烧 token，维度放宽等于成本失控',
    )
    console.log(`  PASS E2. 付费路由：每 IP 每小时天花板（${String(IP_HOURLY)}）拦住了换标识的调用`)

    // 关键反向断言：普通路由绝不能被这个每小时的桶波及。
    for (let i = 0; i < 4; i += 1) {
      const client = `u${String(i)}`
      assert.equal(await hit('unpaid', client), 200, '未声明 ai-ip 的路由不应被每小时天花板计数')
    }
    console.log('  PASS E3. 普通路由：skipIf 确实跳过，未被每小时天花板误伤')
  } finally {
    await app.close()
  }
}

async function run(): Promise<void> {
  main()
  await verifyCeilingRuntime()
  console.log('PASS: 会花钱的 AI 路由限流维度已全部显式声明，且花费天花板真实生效')
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
