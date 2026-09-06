/**
 * 匿名公网 AI 端点的限流与配额门禁。
 *
 * 守的事实：
 *
 *   1. `POST /assistant/chat` 与 `POST /resume/parse` **都有限流装饰器**。
 *      改动前这两个是全部 AI 路由里唯二没有 @Throttle 的，落进 60 次/分钟的
 *      公共默认桶（兄弟 LLM 路由是 6 次/分钟），偏偏又是流量最大的两个。
 *   2. 两个 handler **真的调用了配额闸门**，且失败时回滚。
 *      光有装饰器不算数 —— 限流只管每分钟，配额才管每天花多少 token。
 *   3. 配额本身的行为：三维度（member / terminal / ip）分别计数、任一超限即 429、
 *      超限回滚、Redis 故障 fail-closed、维度值摘要后入 key 不落明文。
 *   4. **不加认证**：匿名是产品口径（求职者不该被迫注册才能用 AI），
 *      这两个 handler 上不得出现 Guard。
 *
 * 不连真实 Redis、不连数据库、不调用任何模型。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { HttpException, ServiceUnavailableException } from '@nestjs/common'
import ts from 'typescript'
import type { RedisService } from '../src/common/redis/redis.service'
import { AiPublicQuotaService, type AiPublicOperation } from '../src/ai/ai-public-quota.service'

const API_ROOT = path.resolve(__dirname, '..')
const AI_CONTROLLER = 'src/ai/ai.controller.ts'

const GUARDED_HANDLERS = [
  { handler: 'chatWithAssistant', operation: 'assistant_chat' },
  { handler: 'submitResumeParse', operation: 'resume_parse' },
] as const

// ---------------------------------------------------------------------------
// 假 Redis：记录每个 key 的计数与 decr 调用，便于断言回滚
// ---------------------------------------------------------------------------

interface FakeRedis {
  service: RedisService
  counts: Map<string, number>
  decrements: string[]
}

function makeFakeRedis(options?: { failOn?: 'incr' }): FakeRedis {
  const counts = new Map<string, number>()
  const decrements: string[] = []
  const service = {
    async incrWithTtl(key: string): Promise<number> {
      if (options?.failOn === 'incr') throw new Error('redis down')
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return next
    },
    async decr(key: string): Promise<number> {
      decrements.push(key)
      const next = (counts.get(key) ?? 0) - 1
      counts.set(key, next)
      return next
    },
  } as unknown as RedisService
  return { service, counts, decrements }
}

function setLimits(member: number, terminal: number, ip: number): void {
  process.env['AI_ASSISTANT_MEMBER_DAILY_LIMIT'] = String(member)
  process.env['AI_ASSISTANT_TERMINAL_DAILY_LIMIT'] = String(terminal)
  process.env['AI_ASSISTANT_IP_DAILY_LIMIT'] = String(ip)
}

function clearLimits(): void {
  delete process.env['AI_ASSISTANT_MEMBER_DAILY_LIMIT']
  delete process.env['AI_ASSISTANT_TERMINAL_DAILY_LIMIT']
  delete process.env['AI_ASSISTANT_IP_DAILY_LIMIT']
}

const OP: AiPublicOperation = 'assistant_chat'

// ---------------------------------------------------------------------------
// 断言 3：配额行为
// ---------------------------------------------------------------------------

async function verifyQuotaBehaviour(): Promise<void> {
  // ── 三个维度都计数（IP 是不可伪造的花费天花板）────────────────────
  {
    setLimits(100, 100, 100)
    const redis = makeFakeRedis()
    const quota = new AiPublicQuotaService(redis.service)
    const ticket = await quota.consume(OP, { member: 'm-1', terminal: 't-1', ip: '1.2.3.4' })
    assert.equal(ticket.keys.length, 3, 'member / terminal / ip 三个维度都必须计数')
    assert.ok(
      ticket.keys.some((key) => key.includes(':ip:')),
      'IP 维度必须始终计数 —— terminal 头可伪造，只有 IP 能给花费封顶',
    )
    console.log('  PASS 三维度（member / terminal / ip）同时计数')

    // ── 维度值不得以明文进 key ────────────────────────────────────
    for (const key of ticket.keys) {
      assert.ok(!key.includes('m-1'), 'key 不得包含会员标识明文')
      assert.ok(!key.includes('t-1'), 'key 不得包含终端标识明文')
      assert.ok(!key.includes('1.2.3.4'), 'key 不得包含 IP 明文')
    }
    console.log('  PASS 维度值 sha256 摘要后入 key，不落明文')
  }

  // ── 超限即 429，且回滚已计数的维度 ────────────────────────────────
  {
    setLimits(2, 100, 100)
    const redis = makeFakeRedis()
    const quota = new AiPublicQuotaService(redis.service)
    const ctx = { member: 'm-2', terminal: 't-2', ip: '1.2.3.5' }
    await quota.consume(OP, ctx)
    await quota.consume(OP, ctx)

    let thrown: unknown = null
    try {
      await quota.consume(OP, ctx)
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown instanceof HttpException, '超出日配额必须抛 HttpException')
    assert.equal((thrown as HttpException).getStatus(), 429, '超出日配额必须是 429')
    const body = (thrown as HttpException).getResponse() as { error?: { code?: string } }
    assert.equal(body.error?.code, 'AI_PUBLIC_QUOTA_EXCEEDED', '错误码必须可被前端识别')
    assert.ok(redis.decrements.length > 0, '超限时必须回滚本次已经 INCR 过的维度')
    console.log('  PASS 超出日配额 -> 429 AI_PUBLIC_QUOTA_EXCEEDED，且已计数维度被回滚')
  }

  // ── 同 IP 不同终端不共享日配额（与限流维度同一口径）──────────────
  {
    setLimits(100, 1, 100)
    const redis = makeFakeRedis()
    const quota = new AiPublicQuotaService(redis.service)
    await quota.consume(OP, { member: null, terminal: 'hall-a', ip: '10.0.0.9' })
    // 同一 IP、另一台机器：终端维度是独立的，不应被上一台用掉。
    await quota.consume(OP, { member: null, terminal: 'hall-b', ip: '10.0.0.9' })
    let secondCallOnSameTerminal: unknown = null
    try {
      await quota.consume(OP, { member: null, terminal: 'hall-a', ip: '10.0.0.9' })
    } catch (error) {
      secondCallOnSameTerminal = error
    }
    assert.ok(
      secondCallOnSameTerminal instanceof HttpException,
      '同一终端超出自己的日配额仍必须被拦（不是把配额关掉了）',
    )
    console.log('  PASS 同 IP 不同终端各有独立日配额；同终端超限仍被拦')
  }

  // ── 调用失败时归还额度 ───────────────────────────────────────────
  {
    setLimits(100, 100, 100)
    const redis = makeFakeRedis()
    const quota = new AiPublicQuotaService(redis.service)
    const ticket = await quota.consume(OP, { member: 'm-3', terminal: 't-3', ip: '1.2.3.6' })
    await quota.rollback(ticket)
    assert.deepEqual(
      redis.decrements.sort(),
      [...ticket.keys].sort(),
      '下游失败时必须归还全部已计数维度，用户不该为没拿到的结果买单',
    )
    console.log('  PASS 下游失败时 rollback 归还全部维度')
  }

  // ── Redis 故障 fail-closed ──────────────────────────────────────
  {
    setLimits(100, 100, 100)
    const quota = new AiPublicQuotaService(makeFakeRedis({ failOn: 'incr' }).service)
    let thrown: unknown = null
    try {
      await quota.consume(OP, { member: null, terminal: null, ip: '1.2.3.7' })
    } catch (error) {
      thrown = error
    }
    assert.ok(
      thrown instanceof ServiceUnavailableException,
      '配额基础设施不可用时必须 fail-closed（503），不能放任 token 无限燃烧',
    )
    console.log('  PASS Redis 故障 -> 503 fail-closed（与 job-ai 同口径）')
  }

  clearLimits()
}

// ---------------------------------------------------------------------------
// 断言 1 / 2 / 4：controller 静态契约
// ---------------------------------------------------------------------------

function findMethod(source: ts.SourceFile, name: string): ts.MethodDeclaration | null {
  let found: ts.MethodDeclaration | null = null
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function decoratorNames(node: ts.MethodDeclaration): string[] {
  return (ts.getDecorators(node) ?? []).map((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression
    return ts.isIdentifier(expression) ? expression.text : ''
  })
}

async function verifyControllerContract(): Promise<void> {
  const filePath = path.join(API_ROOT, AI_CONTROLLER)
  const source = ts.createSourceFile(
    filePath,
    await readFile(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  const failures: string[] = []

  for (const target of GUARDED_HANDLERS) {
    const method = findMethod(source, target.handler)
    if (!method) {
      failures.push(`${AI_CONTROLLER}#${target.handler}: 找不到该 handler`)
      continue
    }

    const decorators = decoratorNames(method)

    // 断言 1：必须有限流装饰器。
    const throttled = decorators.includes('Throttle') || decorators.includes('TerminalScopedThrottle')
    if (!throttled) {
      failures.push(
        `${AI_CONTROLLER}#${target.handler}: 匿名且会花钱的端点必须挂限流装饰器 ` +
          '（改动前它落进 60 次/分钟的公共默认桶，是兄弟 LLM 路由的 10 倍）',
      )
    }

    // 断言 4：不得加认证门槛 —— 匿名是产品口径。
    if (decorators.includes('UseGuards')) {
      failures.push(
        `${AI_CONTROLLER}#${target.handler}: 不得加 @UseGuards —— ` +
          '匿名可用是产品口径，这里只加限流与配额',
      )
    }

    // 断言 2：必须真的调用配额闸门，并在失败时回滚。
    const body = method.body ? method.body.getText(source) : ''
    if (!body.includes(`publicQuota.consume('${target.operation}'`)) {
      failures.push(
        `${AI_CONTROLLER}#${target.handler}: 必须调用 ` +
          `publicQuota.consume('${target.operation}', ...) —— ` +
          '限流只管每分钟，日配额才管每天烧多少 token',
      )
    }
    if (!body.includes('publicQuota.rollback') && !body.includes('runWithPublicQuota')) {
      failures.push(
        `${AI_CONTROLLER}#${target.handler}: 下游失败时必须 publicQuota.rollback(...) 或 runWithPublicQuota（内含 rollback），` +
          '否则失败的调用也会吃掉用户当日额度',
      )
    }
  }

  assert.deepEqual(failures, [], `AI 公网端点静态契约失败:\n${failures.join('\n')}`)
  const guardSrc = await readFile(path.join(API_ROOT, 'src/ai/ai-request-guard.ts'), 'utf8')
  assert.ok(guardSrc.includes('quota.rollback'), 'runWithPublicQuota 必须调用 quota.rollback')
  console.log(`  PASS 静态核验：${GUARDED_HANDLERS.length} 个匿名 AI 端点均有限流 + 配额且未加认证门槛`)
}

async function main(): Promise<void> {
  console.log('=== 匿名公网 AI 端点限流与日配额验证 ===')
  await verifyControllerContract()
  await verifyQuotaBehaviour()
  console.log('PASS: /assistant/chat 与 /resume/parse 已具备限流与日配额，且仍保持匿名可用')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
