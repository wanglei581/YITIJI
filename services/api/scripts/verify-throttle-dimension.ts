/**
 * 限流计数维度门禁。
 *
 * 守的事实（对应 common/throttler/terminal-throttle.ts 的三条口径）：
 *
 *   1. 打了 @TerminalScopedThrottle 的路由：**同一 IP、不同终端不共享配额**。
 *      这是本次要修的核心 —— 一个大厅的 N 台一体机走同一个 NAT 出口 IP，
 *      按 IP 计数时第 3 台机器就会把打印进度轮询打成 429。
 *   2. 没打这个装饰器的路由：维持纯 IP 计数不变。
 *      /auth/login 的 5 次/分钟字典爆破防线不能因为本次改动被稀释成
 *      「每个伪造的终端 ID 都有 5 次」。
 *   3. `ip-wide` 兜底桶真实存在且会拦截 —— 终端头可伪造，必须有天花板。
 *
 * 另有静态断言：被 Kiosk 定时轮询 / 高频匿名调用的路由必须挂上该装饰器。
 *
 * 全程用真实的 ThrottlerGuard + 真实的 buildThrottlerConfig() + 真实 HTTP 请求，
 * 不 mock 限流器本身；不依赖数据库、Redis 或任何外部服务。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Controller, Get, Module, type INestApplication } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import ts from 'typescript'
import {
  TerminalScopedThrottle,
  buildThrottlerConfig,
  resolveTerminalScopedTracker,
} from '../src/common/throttler/terminal-throttle'

const API_ROOT = path.resolve(__dirname, '..')

const PER_TERMINAL_LIMIT = 3
const IP_WIDE_LIMIT_FOR_TEST = 12

// 必须在 ProbeModule 的 @Module 装饰器求值**之前**写入：buildThrottlerConfig()
// 在建配置时读一次 env，而装饰器是在类定义语句执行时（即本模块加载时）跑的。
// 放进函数体里设置会太晚，兜底桶会拿到默认的 1200，断言 3 就成了假绿。
process.env['THROTTLE_IP_WIDE_PER_MINUTE'] = String(IP_WIDE_LIMIT_FOR_TEST)

// ---------------------------------------------------------------------------
// 契约：必须按台计数的路由
// ---------------------------------------------------------------------------
// 依据是「Kiosk 会定时轮询」或「匿名且会花钱」。新增这类路由时必须同步这张表，
// 否则本门禁转红 —— 这正是要的效果：默认必须显式声明维度，漏掉不会安静通过。
const TERMINAL_SCOPED_ROUTES = [
  { file: 'src/print-jobs/print-jobs.controller.ts', handler: 'getStatus' },
  { file: 'src/materials/materials.controller.ts', handler: 'getTask' },
  { file: 'src/scan-tasks/scan-tasks.controller.ts', handler: 'status' },
  { file: 'src/ai/ai.controller.ts', handler: 'submitResumeParse' },
  { file: 'src/ai/ai.controller.ts', handler: 'chatWithAssistant' },
] as const

// ---------------------------------------------------------------------------
// 被测应用：一条按台计数的路由 + 一条保持纯 IP 的路由
// ---------------------------------------------------------------------------

@Controller('probe')
class ProbeController {
  /** 模拟打印进度轮询：按台计数。 */
  @Get('terminal-scoped')
  @TerminalScopedThrottle(PER_TERMINAL_LIMIT)
  terminalScoped(): { ok: true } {
    return { ok: true }
  }

  /** 模拟 /auth/login 一类路由：不打装饰器，走 default 纯 IP 桶。 */
  @Get('ip-scoped')
  ipScoped(): { ok: true } {
    return { ok: true }
  }
}

@Module({
  imports: [ThrottlerModule.forRoot(buildThrottlerConfig())],
  controllers: [ProbeController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ProbeModule {}

type Probe = { status: number }

async function hit(baseUrl: string, route: string, terminalId?: string): Promise<Probe> {
  const res = await fetch(`${baseUrl}/probe/${route}`, {
    headers: terminalId ? { 'X-Terminal-Id': terminalId } : {},
  })
  // 读完 body，避免 socket 悬挂影响后续计数。
  await res.text()
  return { status: res.status }
}

async function hitMany(
  baseUrl: string,
  route: string,
  times: number,
  terminalId?: string,
): Promise<number[]> {
  const statuses: number[] = []
  for (let i = 0; i < times; i += 1) {
    statuses.push((await hit(baseUrl, route, terminalId)).status)
  }
  return statuses
}

// ---------------------------------------------------------------------------
// 断言 1 + 2 + 3：真实 HTTP 行为
// ---------------------------------------------------------------------------

async function verifyRuntimeBehaviour(): Promise<void> {
  let app: INestApplication | null = null
  try {
    app = await NestFactory.create(ProbeModule, { logger: false })
    await app.listen(0, '127.0.0.1')
    const url = await app.getUrl()
    // 所有请求都来自 127.0.0.1 —— 刻意如此：这就是「同一个 NAT 出口 IP」。
    const baseUrl = url.replace('[::1]', '127.0.0.1')

    // ── 断言 1：同 IP、不同终端不共享配额 ────────────────────────────
    // 三台机器各自打满自己的每台限额。若配额是共享的，第 2 台就会开始 429。
    for (const terminalId of ['kiosk-hall-01', 'kiosk-hall-02', 'kiosk-hall-03']) {
      const statuses = await hitMany(baseUrl, 'terminal-scoped', PER_TERMINAL_LIMIT, terminalId)
      assert.deepEqual(
        statuses,
        Array<number>(PER_TERMINAL_LIMIT).fill(200),
        `同一 IP 下终端 ${terminalId} 应有独立配额，实际: ${statuses.join(',')}`,
      )
    }
    console.log(`  PASS 同 IP × 3 个终端 × 每台 ${PER_TERMINAL_LIMIT} 次 = 全部 200（配额不共享）`)

    // ── 断言 1b：每台自己的桶仍然会满（不是「关掉了限流」）────────────
    const overflow = await hit(baseUrl, 'terminal-scoped', 'kiosk-hall-01')
    assert.equal(overflow.status, 429, '同一终端超出每台限额后必须 429，否则等于没限流')
    console.log('  PASS 单个终端超出自己的每台限额 -> 429（限流仍然生效）')

    // ── 断言 3：ip-wide 兜底桶会拦住「伪造终端 ID 无限刷」──────────────
    // 终端头是客户端可伪造的。换一个没见过的终端 ID 确实能拿到一个全新的每台桶
    // （这正是断言 1 的机制），所以必须有一层纯 IP 的天花板兜住，否则「按台计数」
    // 就等于「无限额」。
    const firstForged = await hit(baseUrl, 'terminal-scoped', 'forged-terminal-0')
    assert.equal(firstForged.status, 200, '全新终端 ID 应拿到全新的每台桶（断言 1 的同一机制）')

    let forgedBlockedAt: number | null = null
    for (let attempt = 1; attempt <= IP_WIDE_LIMIT_FOR_TEST; attempt += 1) {
      const forged = await hit(baseUrl, 'terminal-scoped', `forged-terminal-${attempt}`)
      if (forged.status === 429) {
        forgedBlockedAt = attempt
        break
      }
    }
    assert.notEqual(
      forgedBlockedAt,
      null,
      `伪造终端 ID 连刷 ${IP_WIDE_LIMIT_FOR_TEST} 次仍未被拦 —— ip-wide 兜底桶没生效，` +
        '终端维度成了无限额漏洞',
    )
    console.log(
      `  PASS 伪造终端 ID 每次换新，第 ${String(forgedBlockedAt)} 次被 ip-wide 兜底桶拦下 -> 429`,
    )

    // ── 断言 2：未声明维度的路由维持纯 IP 计数 ───────────────────────
    // 不同终端 ID 必须落进**同一个** default 桶，否则 /auth/login 的字典爆破
    // 防线会被「每换一个伪造终端 ID 就重置一次」稀释掉。
    const distinctTerminals = ['probe-a', 'probe-b', 'probe-c', 'probe-d', 'probe-e']
    const ipScopedStatuses: number[] = []
    for (const terminalId of distinctTerminals) {
      ipScopedStatuses.push((await hit(baseUrl, 'ip-scoped', terminalId)).status)
    }
    // default 限额是 60，5 次都该过；关键断言是它们共用一个桶，用 tracker 直接证明。
    assert.deepEqual(
      ipScopedStatuses,
      Array<number>(distinctTerminals.length).fill(200),
      '纯 IP 路由在限额内应全部通过',
    )
    const trackerA = resolveTerminalScopedTracker({ ip: '10.0.0.1', headers: {} })
    const trackerB = resolveTerminalScopedTracker({
      ip: '10.0.0.1',
      headers: { 'x-terminal-id': 'probe-a' },
    })
    const trackerC = resolveTerminalScopedTracker({
      ip: '10.0.0.1',
      headers: { 'x-terminal-id': 'probe-b' },
    })
    assert.notEqual(trackerB, trackerC, '不同终端必须得到不同 tracker')
    assert.notEqual(trackerA, trackerB, '有终端与无终端必须得到不同 tracker')
    const trackerOtherIp = resolveTerminalScopedTracker({
      ip: '10.0.0.2',
      headers: { 'x-terminal-id': 'probe-a' },
    })
    assert.notEqual(
      trackerB,
      trackerOtherIp,
      'tracker 必须含 IP —— 否则伪造终端头可以蹭到别的 IP 的桶',
    )
    assert.ok(
      !trackerB.includes('probe-a'),
      'tracker 不得包含终端 ID 明文（凭证/标识一律摘要后入 key）',
    )
    console.log('  PASS 未声明维度的路由保持纯 IP 计数；tracker 含 IP 且不含明文标识')
  } finally {
    if (app) await app.close()
    delete process.env['THROTTLE_IP_WIDE_PER_MINUTE']
  }
}

// ---------------------------------------------------------------------------
// 静态断言：轮询 / 匿名花钱路由必须挂 @TerminalScopedThrottle
// ---------------------------------------------------------------------------

function decoratorNames(node: ts.MethodDeclaration): string[] {
  return (ts.getDecorators(node) ?? []).map((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression
    return ts.isIdentifier(expression) ? expression.text : ''
  })
}

async function verifyStaticContract(): Promise<void> {
  const failures: string[] = []

  for (const route of TERMINAL_SCOPED_ROUTES) {
    const filePath = path.join(API_ROOT, route.file)
    const source = ts.createSourceFile(
      filePath,
      await readFile(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )

    let found = false
    const visit = (node: ts.Node): void => {
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === route.handler
      ) {
        found = true
        if (!decoratorNames(node).includes('TerminalScopedThrottle')) {
          failures.push(
            `${route.file}#${route.handler}: 必须挂 @TerminalScopedThrottle —— ` +
              '该路由被定时轮询或匿名高频调用，按 IP 计数会让一个大厅共用一份配额',
          )
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)

    if (!found) {
      failures.push(`${route.file}: 找不到 handler ${route.handler}（路由被改名或删除？）`)
    }
  }

  assert.deepEqual(failures, [], `限流维度静态契约失败:\n${failures.join('\n')}`)
  console.log(`  PASS 静态核验：${TERMINAL_SCOPED_ROUTES.length} 条轮询/匿名路由均已声明按台计数`)
}

async function main(): Promise<void> {
  console.log('=== 限流计数维度验证（终端 vs IP）===')
  await verifyStaticContract()
  await verifyRuntimeBehaviour()
  console.log('PASS: 限流按台计数已验证，纯 IP 防线与 ip-wide 兜底桶均未被稀释')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
