import { join } from 'path'
import { readFileSync } from 'fs'
import { BadRequestException, ValidationPipe, ForbiddenException } from '@nestjs/common'
import { PartnerStatsQueryDto, PartnerStatsController } from '../../src/orgs/partner-stats.controller'
import { Assert } from './partner-terminal-ops-cases-04'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PartnerStatsService } from '../../src/orgs/partner-stats.service'
import { PartnerOrgRequiredError, type PartnerOrgId } from '../../src/console-screen/console-screen.org'
import type { AuthedUser } from '../../src/common/decorators/current-user.decorator'




export function collectPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, `${prefix}[]`, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      out.add(path)
      collectPaths(child, path, out)
    }
  }
  return out
}


export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}


export function rejects(fn: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(fn)
    .then(() => null, (error: unknown) => error)
}


export async function verifyStaticAndQuery(assert: Assert): Promise<void> {
  const controller = stripComments(readFileSync(join(__dirname, '../../src/orgs/partner-stats.controller.ts'), 'utf8'))
  assert(
    'T1a. 新端点 GET partner/terminal-operations 与 /partner/stats 同 controller、同守卫角色',
    controller.includes("@Get('partner/terminal-operations')")
      && /@UseGuards\(JwtAuthGuard, RolesGuard\)\s*@Roles\('partner'\)\s*export class PartnerStatsController/.test(controller),
  )
  assert(
    'T1b. 两个端点都经 requirePartnerOrgId 取机构，不再用 user.orgId! 断言非空',
    (controller.match(/scopedPartnerOrgId\(user\.orgId\)/g) ?? []).length === 2 && !controller.includes('user.orgId!'),
  )

  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED' } }),
  })
  const meta = { type: 'query' as const, metatype: PartnerStatsQueryDto }
  const codeOf = async (value: Record<string, unknown>): Promise<string | null> => {
    const error = await rejects(() => pipe.transform(value, meta))
    if (!error) return null
    const res = (error as BadRequestException).getResponse() as { error?: { code?: string } }
    return res?.error?.code ?? 'UNKNOWN'
  }
  assert('T1c. ?period=quarter 通过', (await codeOf({ period: 'quarter' })) === null)
  assert('T1d. ?orgId= 被拒成 400 VALIDATION_FAILED', (await codeOf({ period: 'week', orgId: 'org_x' })) === 'VALIDATION_FAILED')
  assert('T1e. 未知参数被拒成 400', (await codeOf({ terminalId: 't1' })) === 'VALIDATION_FAILED')
  assert('T1f. 非法 period 被拒成 400', (await codeOf({ period: 'year' })) === 'VALIDATION_FAILED')
}


export async function verifyFailClosed(assert: Assert, prisma: PrismaService): Promise<void> {
  const service = new PartnerStatsService(prisma)
  const controller = new PartnerStatsController(service)
  const user = (orgId: string | null): AuthedUser => ({ userId: 'u_verify', role: 'partner', orgId })
  for (const orgId of [null, '', '   ']) {
    const error = await rejects(() => controller.getTerminalOperations(user(orgId), {}))
    const body = error instanceof ForbiddenException
      ? (error.getResponse() as { error?: { code?: string } })
      : null
    assert(
      `T2a. 账号机构为 ${JSON.stringify(orgId)} 时终端数据 403 ORG_REQUIRED`,
      body?.error?.code === 'ORG_REQUIRED',
      String(error),
    )
  }
  const statsError = await rejects(() => controller.getStats(user(null), {}))
  assert('T2b. /partner/stats 同样 403 ORG_REQUIRED', statsError instanceof ForbiddenException)
  const serviceError = await rejects(() => service.getTerminalOperations('' as PartnerOrgId, 'week'))
  assert('T2c. service 收到空机构直接拒绝，不查库', serviceError instanceof PartnerOrgRequiredError)

  // 没有绑定终端：只允许发一次按本机构过滤的终端查询，其余模型一条都不能碰。
  const calls: string[] = []
  const trap = (name: string) => new Proxy({}, {
    get: (_target, method) => () => {
      calls.push(`${name}.${String(method)}`)
      throw new Error(`不应查询 ${name}.${String(method)}`)
    },
  })
  const fake = {
    terminal: {
      findMany: async (args: { where?: { orgId?: unknown } }) => {
        calls.push(`terminal.findMany:${JSON.stringify(args.where)}`)
        return []
      },
    },
    printTask: trap('printTask'),
    scanTask: trap('scanTask'),
    terminalHeartbeat: trap('terminalHeartbeat'),
  } as unknown as PrismaService
  const empty = await new PartnerStatsService(fake).getTerminalOperations('org_no_terminals' as PartnerOrgId, 'month')
  assert(
    'T2d. 机构没有终端：只按本机构查一次终端表，任务与心跳一条都不查',
    calls.length === 1 && calls[0] === 'terminal.findMany:{"orgId":"org_no_terminals"}',
    calls.join(' | '),
  )
  assert(
    'T2e. 机构没有终端：返回空列表与全 0 合计，比率为 null',
    empty.terminals.length === 0
      && empty.totals.terminalCount === 0
      && empty.totals.serviceCount === 0
      && empty.totals.output.settled === 0
      && empty.totals.output.successRate === null
      && empty.period === 'month',
  )
}
