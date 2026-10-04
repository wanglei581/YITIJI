import { verifyResidualPrivacy } from './support/console-screen-residual-privacy'
import { PrismaService } from '../src/prisma/prisma.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { ConsoleScreenUsageService } from '../src/console-screen/console-screen.usage.service'
import { assertSmallSampleFloorSetup, assertBehavior } from './console-screen-usage-cases-05'
import { assertSmallSampleFloorPhase1, assertSmallSampleFloorPhase2 } from './console-screen-usage-cases-06'
import { randomUUID } from 'node:crypto'
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { AdminUsageController, PartnerUsageController } from '../src/console-screen/console-screen.usage.controller'
import { assert, passed, failed, assertSourceContract } from './console-screen-usage-cases-01'
import { shanghaiDayKey } from '../src/console-screen/console-screen.metric'
import { usageWindow } from '../src/console-screen/console-screen.usage.queries'



export async function assertSmallSampleFloor(input: {
  prisma: PrismaService
  usage: ConsoleScreenUsageService
  cache: ScreenSnapshotCache
  memberId: string
  terminalId: string
  fileUrl: string
  suffix: string
}): Promise<void> {
const context = await assertSmallSampleFloorSetup(input)
const phase1 = await assertSmallSampleFloorPhase1(context)
await assertSmallSampleFloorPhase2(phase1)

}


export async function assertHttp(
  prisma: PrismaService,
  ids: { adminId: string; userA: string; userB: string; userBlank: string; orgA: string },
): Promise<void> {
  process.env['JWT_SECRET'] ||= 'dev-only-secret-please-replace-in-prod-min-16-chars'
  const cache = new ScreenSnapshotCache()
  @Module({
    imports: [JwtModule.register({ secret: process.env['JWT_SECRET'], signOptions: { expiresIn: '30m' } })],
    controllers: [AdminUsageController, PartnerUsageController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      ConsoleScreenUsageService,
      { provide: ScreenSnapshotCache, useValue: cache },
      JwtAuthGuard,
      RolesGuard,
      Reflector,
      { provide: RedisService, useValue: { get: async () => null, del: async () => 0, setJsonIfVersionNotOlder: async () => 'stored' as const } },
    ],
  })
  class UsageHttpModule {}

  const app = await NestFactory.create<NestExpressApplication>(UsageHttpModule, { logger: ['error'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  try {
    const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
    const jwt = app.get(JwtService)
    const adminToken = jwt.sign({ sub: ids.adminId, ver: 0, jti: randomUUID() })
    const partnerToken = jwt.sign({ sub: ids.userA, ver: 0, jti: randomUUID(), orgId: ids.orgA, role: 'admin' })
    const otherToken = jwt.sign({ sub: ids.userB, ver: 0, jti: randomUUID() })
    const blankToken = jwt.sign({ sub: ids.userBlank, ver: 0, jti: randomUUID() })
    const adminHeaders = { Authorization: `Bearer ${adminToken}` }
    const partnerHeaders = { Authorization: `Bearer ${partnerToken}` }

    const unauth = await fetch(`${base}/admin/screen/usage`)
    assert('u32. 无 token 为 401', unauth.status === 401, String(unauth.status))
    const badRange = await fetch(`${base}/admin/screen/usage?range=90d`, { headers: adminHeaders })
    assert('u33. 非法 range 为 400', badRange.status === 400, String(badRange.status))
    const extra = await fetch(`${base}/admin/screen/usage?range=today&orgId=${ids.orgA}`, { headers: adminHeaders })
    assert('u34. 管理员多传 orgId 为 400', extra.status === 400, String(extra.status))
    const partnerOnAdmin = await fetch(`${base}/admin/screen/usage`, { headers: partnerHeaders })
    assert('u35. 机构账号调管理员用法为 403', partnerOnAdmin.status === 403, String(partnerOnAdmin.status))
    const adminOnPartner = await fetch(`${base}/partner/screen/usage`, { headers: adminHeaders })
    assert('u36. 管理员调机构用法为 403', adminOnPartner.status === 403, String(adminOnPartner.status))
    const orgQuery = await fetch(`${base}/partner/screen/usage?orgId=${ids.orgA}`, { headers: partnerHeaders })
    assert('u37. 机构端传 orgId 查询参数为 400', orgQuery.status === 400, String(orgQuery.status))

    const adminRes = await fetch(`${base}/admin/screen/usage`, { headers: adminHeaders })
    const adminBody = await adminRes.json() as { success?: boolean; data?: { range?: string; audience?: string } }
    assert('u38. 缺省 range=today，管理员走 ApiResponse', adminRes.status === 200 && adminBody.success === true && adminBody.data?.range === 'today' && adminBody.data.audience === 'admin')

    const partnerRes = await fetch(`${base}/partner/screen/usage?range=7d`, { headers: partnerHeaders })
    const partnerBody = await partnerRes.json() as { success?: boolean; audience?: string; range?: string; metrics?: { partnerTop?: { available?: boolean; value?: { items?: Array<{ title?: string }> } } } }
    const titles = JSON.stringify(partnerBody)
    assert(
      'u39. 机构端是裸对象，JWT 里的 orgId/role 不被采信',
      partnerRes.status === 200
        && partnerBody.success === undefined
        && partnerBody.audience === 'partner'
        && partnerBody.range === '7d'
        && titles.includes('甲机构岗位')
        && !titles.includes('乙机构岗位'),
      titles.slice(0, 240),
    )
    const otherRes = await fetch(`${base}/partner/screen/usage?range=7d`, { headers: { Authorization: `Bearer ${otherToken}` } })
    const otherBody = await otherRes.text()
    assert('u40. 另一家机构看不到甲的标题', otherRes.status === 200 && otherBody.includes('乙机构岗位') && !otherBody.includes('甲机构岗位'), otherBody.slice(0, 240))
    const blankRes = await fetch(`${base}/partner/screen/usage`, { headers: { Authorization: `Bearer ${blankToken}` } })
    assert('u41. 未绑定机构的账号为 401', blankRes.status === 401, String(blankRes.status))
  } finally {
    await app.close()
  }
}


export async function main(): Promise<void> {
  verifyResidualPrivacy(assert)
  console.log('\n=== console screen usage 契约 ===\n')
  assertSourceContract()
  const anchor = usageWindow('today', NOW)
  assert(
    'u0. 独立算出的上海零点与 usageWindow 一致',
    anchor.from.toISOString() === '2026-01-14T16:00:00.000Z' && shanghaiDayKey(NOW) === '2026-01-15',
  )
  await assertBehavior()
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:console-screen-usage FAILED')
    process.exit(1)
  }
  console.log('\n✅ verify:console-screen-usage PASSED')
}


export const EXPECTED_NODES = [
  { key: 'jobs', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['job'] },
  { key: 'fairs', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['job_fair', 'fair_company'] },
  { key: 'policy', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['policy'] },
  { key: 'company', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['company_profile'] },
  { key: 'aiResume', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['parseResume', 'optimizeResume', 'adjustResumeLayout', 'generateResume'] },
  { key: 'aiAdvisor', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['chatAssistant'] },
  { key: 'interview', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['interviewQuestion', 'interviewReport'] },
  { key: 'careerPlan', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['careerPlan', 'selfAssessment'] },
  { key: 'jobAi', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['jobRecommend', 'jobExplain', 'jobMatch', 'fairVisitPlan'] },
  { key: 'print', lane: 'print', coverage: 'all_recorded', kind: 'print_created' },
  { key: 'scan', lane: 'print', coverage: 'all_recorded', kind: 'scan_created' },
] as const

export const NOW = new Date('2026-01-15T02:07:30.000Z')

export const TODAY_START = new Date('2026-01-14T16:00:00.000Z')

export const BEFORE_TODAY = new Date(TODAY_START.getTime() - 1)

export const DAY7_START = new Date(TODAY_START.getTime() - 7 * 86_400_000)

export const DAY30_START = new Date(TODAY_START.getTime() - 30 * 86_400_000)

export const BEFORE_30 = new Date(DAY30_START.getTime() - 1)

export const HOUR1 = new Date('2026-01-14T17:10:00.000Z')

export const HOUR4 = new Date('2026-01-14T20:00:00.000Z')

export const HOUR7 = new Date('2026-01-14T23:10:00.000Z')

export const PULSE_AI = new Date('2026-01-15T00:12:00.000Z')

export const YESTERDAY_NOON = new Date('2026-01-14T04:00:00.000Z')

export const PHONE = '13900001111'

export const FILE_NAME = '张三的简历.pdf'

export const ORDER_SECRET = 'ORD机密单号'

export const IP_SECRET = '203.0.113.55'

export const APP_COMPANY = '自填机密公司'

export const FAVORITE_SNAPSHOT = '收藏快照不要用'

export interface AiSeed {
  operation: string
  status: string
  provider: string
  estimatedCostCny: number | null
  latencyMs: number | null
  createdAt: Date
}

export interface OrderSeed {
  orderNo: string
  payStatus: string
  channel: string | null
  paidAt: Date | null
  endUserId: string | null
  createdAt: Date
}

export interface PrintSeed {
  id: string
  createdAt: Date
  status: string
  completedAt: Date | null
  printOutcome: string | null
  updatedAt: Date
}


export function carryContext<A extends object, B extends object>(before: A, next: B): A & B {
  return Object.defineProperties({ ...before, ...next }, { ...Object.getOwnPropertyDescriptors(before), ...Object.getOwnPropertyDescriptors(next) })
}
