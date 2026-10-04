import { randomUUID } from 'node:crypto'
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { AdminScreenController } from '../src/console-screen/console-screen.admin.controller'
import { PartnerScreenController } from '../src/console-screen/console-screen.partner.controller'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { assert, passed, failed } from './console-screen-snapshot-cases-01'
import { assertSourceContract } from './console-screen-snapshot-cases-03'
import { assertPureHelpers } from './console-screen-snapshot-cases-06'
import { assertServiceContract } from './console-screen-snapshot-cases-14'
import { type TimelineHeartbeat, type TimelinePrintInterval } from '../src/console-screen/console-screen.timeline'



export async function assertHttp(
  prisma: PrismaService,
  ids: {
    adminId: string
    userA: string
    orgA: string
    orgB: string
    userBlank: string
    termA: string
    termB: string
    suffix: string
    resumeFileName: string
  },
): Promise<void> {
  if (process.env['CONSOLE_SCREEN_SKIP_HTTP'] === '1') {
    console.log('  SKIP HTTP（CONSOLE_SCREEN_SKIP_HTTP=1）')
    return
  }
  process.env['JWT_SECRET'] ||= 'dev-only-secret-please-replace-in-prod-min-16-chars'
  const jwtSecret = process.env['JWT_SECRET']
  const redisStub = {
    get: async () => null,
    del: async () => 0,
    setJsonIfVersionNotOlder: async () => 'stored' as const,
  }
  const cache = new ScreenSnapshotCache()
  @Module({
    imports: [JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '30m' } })],
    controllers: [AdminScreenController, PartnerScreenController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AdminOpsService,
      ConsoleScreenService,
      { provide: ScreenSnapshotCache, useValue: cache },
      JwtAuthGuard,
      RolesGuard,
      Reflector,
      { provide: RedisService, useValue: redisStub },
    ],
  })
  class ScreenHttpModule {}

  const app = await NestFactory.create<NestExpressApplication>(ScreenHttpModule, { logger: ['error'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  try {
    const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
    const jwt = app.get(JwtService)
    const adminToken = jwt.sign({ sub: ids.adminId, ver: 0, jti: randomUUID() })
    const partnerToken = jwt.sign({ sub: ids.userA, ver: 0, jti: randomUUID() })
    const adminAuth = { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' }
    const partnerAuth = { Authorization: `Bearer ${partnerToken}`, Accept: 'application/json' }

    const unauth = await fetch(`${base}/admin/screen/snapshot?profile=gov`)
    assert('4a. 无 token 访问 admin snapshot 为 401', unauth.status === 401, `status=${unauth.status}`)

    const badProfile = await fetch(`${base}/admin/screen/snapshot?profile=public`, { headers: adminAuth })
    assert('4b. 非法 profile 为 400', badProfile.status === 400, `status=${badProfile.status}`)

    const partnerOnAdmin = await fetch(`${base}/admin/screen/snapshot?profile=gov`, { headers: partnerAuth })
    assert('4c. partner 调 admin snapshot 为 403', partnerOnAdmin.status === 403, `status=${partnerOnAdmin.status}`)

    const adminOnPartner = await fetch(`${base}/partner/screen/snapshot`, { headers: adminAuth })
    assert('4d. admin 调 partner snapshot 为 403', adminOnPartner.status === 403, `status=${adminOnPartner.status}`)

    const orgQuery = await fetch(`${base}/partner/screen/snapshot?orgId=${ids.orgA}`, { headers: partnerAuth })
    assert('4e. Partner 传 orgId 查询参数被拒绝', orgQuery.status === 400, `status=${orgQuery.status}`)

    const govRes = await fetch(`${base}/admin/screen/snapshot?profile=gov`, { headers: adminAuth })
    const govBody = await govRes.json() as { success?: boolean; data?: { profile?: string } }
    assert('4f. Admin gov 信封为 ApiResponse.ok', govRes.status === 200 && govBody.success === true && govBody.data?.profile === 'gov', JSON.stringify(govBody).slice(0, 200))

    const partnerRes = await fetch(`${base}/partner/screen/snapshot`, { headers: partnerAuth })
    const partnerBody = await partnerRes.json() as {
      audience?: string
      profile?: string
      success?: boolean
      metrics?: { jobsOnShelf?: { available?: boolean; value?: { published?: number } } }
    }
    assert(
      '4g. Partner snapshot 为裸对象且 audience=partner',
      partnerRes.status === 200 && partnerBody.audience === 'partner' && partnerBody.profile === 'partner' && partnerBody.success === undefined,
      JSON.stringify(partnerBody).slice(0, 200),
    )

    const missingProfile = await fetch(`${base}/admin/screen/snapshot`, { headers: adminAuth })
    assert('4i. 缺 profile 为 400', missingProfile.status === 400, `status=${missingProfile.status}`)

    const displayMode = await fetch(`${base}/admin/screen/snapshot?profile=gov&mode=display`, { headers: adminAuth })
    assert('4j. mode=display 不在白名单，400 fail-closed', displayMode.status === 400, `status=${displayMode.status}`)

    const spoofToken = jwt.sign({
      sub: ids.userA,
      ver: 0,
      jti: randomUUID(),
      orgId: 'org_spoof_from_jwt',
      role: 'admin',
    })
    const spoofRes = await fetch(`${base}/partner/screen/snapshot`, {
      headers: { Authorization: `Bearer ${spoofToken}`, Accept: 'application/json' },
    })
    const spoofBody = await spoofRes.json() as {
      audience?: string
      metrics?: { jobsOnShelf?: { available?: boolean; value?: { published?: number } } }
    }
    assert(
      '4h. JWT 内 orgId/role 声明不被采信，仍按 User 表机构隔离',
      spoofRes.status === 200
        && spoofBody.audience === 'partner'
        && spoofBody.metrics?.jobsOnShelf?.available === true
        && spoofBody.metrics.jobsOnShelf.value?.published === 1,
      JSON.stringify(spoofBody).slice(0, 240),
    )

    const blankToken = jwt.sign({ sub: ids.userBlank, ver: 0, jti: randomUUID() })
    const blankRes = await fetch(`${base}/partner/screen/snapshot`, {
      headers: { Authorization: `Bearer ${blankToken}`, Accept: 'application/json' },
    })
    const blankText = await blankRes.text()
    assert(
      '4k. 未绑定机构的 partner 请求 fail-closed，响应不含跨机构岗位',
      blankRes.status === 401
        && !blankText.includes('A岗1')
        && !blankText.includes('B岗1')
        && !/"published":\s*[1-9]/.test(blankText),
      `status=${blankRes.status} body=${blankText.slice(0, 200)}`,
    )

    const twinUnauth = await fetch(`${base}/admin/screen/terminals/${ids.termA}`)
    assert('5n. 无 token 访问终端孪生为 401', twinUnauth.status === 401, `status=${twinUnauth.status}`)
    const twinRole = await fetch(`${base}/admin/screen/terminals/${ids.termA}`, { headers: partnerAuth })
    assert('5o. partner 调 admin 孪生为 403', twinRole.status === 403, `status=${twinRole.status}`)
    const adminTwinRes = await fetch(`${base}/admin/screen/terminals/${ids.termA}`, { headers: adminAuth })
    const adminTwinBody = await adminTwinRes.json() as { success?: boolean; data?: { terminal?: { id?: string }; printer?: { value?: { colorEnabled?: boolean } } } }
    const adminTwinText = JSON.stringify(adminTwinBody)
    assert(
      '5p. Admin 孪生走 ApiResponse，且响应 JSON 不含中文文件名',
      adminTwinRes.status === 200
        && adminTwinBody.success === true
        && adminTwinBody.data?.terminal?.id === ids.termA
        && adminTwinBody.data?.printer?.value?.colorEnabled === true
        && !adminTwinText.includes(ids.resumeFileName)
        && !adminTwinText.includes('fileName'),
      adminTwinText.slice(0, 240),
    )
    const partnerTwinRes = await fetch(`${base}/partner/screen/terminals/${ids.termA}`, { headers: partnerAuth })
    const partnerTwinBody = await partnerTwinRes.json() as { audience?: string; success?: boolean; terminal?: { id?: string } }
    assert(
      '5q. Partner 孪生是裸对象',
      partnerTwinRes.status === 200
        && partnerTwinBody.audience === 'partner'
        && partnerTwinBody.success === undefined
        && partnerTwinBody.terminal?.id === ids.termA,
    )
    const foreignRes = await fetch(`${base}/partner/screen/terminals/${ids.termB}?orgId=${ids.orgB}`, { headers: partnerAuth })
    const missingRes = await fetch(`${base}/partner/screen/terminals/missing_${ids.suffix}`, { headers: partnerAuth })
    const foreignHttp = await foreignRes.text()
    const missingHttp = await missingRes.text()
    const normalize404 = (text: string) => {
      const body = JSON.parse(text) as { requestId?: string }
      delete body.requestId
      return JSON.stringify(body)
    }
    assert(
      '5r. HTTP 上别家终端与不存在同一 404，query orgId 不能改范围',
      foreignRes.status === 404
        && missingRes.status === 404
        && normalize404(foreignHttp) === normalize404(missingHttp)
        && !foreignHttp.includes(`SCRN-B-${ids.suffix}`)
        && !foreignHttp.includes('大屏机构B')
        && !foreignHttp.includes(ids.resumeFileName),
      `foreign=${foreignRes.status} ${foreignHttp.slice(0, 180)} missing=${missingRes.status}`,
    )
  } finally {
    await app.close()
  }
}


export async function main(): Promise<void> {
  console.log('\n=== console screen snapshot 契约 ===\n')
  assertSourceContract()
  await assertPureHelpers()
  await assertServiceContract()
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:console-screen-snapshot FAILED')
    process.exit(1)
  }
  console.log('\n✅ verify:console-screen-snapshot PASSED')
}


export type TimelineSample = {
  now: Date
  heartbeats: readonly TimelineHeartbeat[]
  prints: readonly TimelinePrintInterval[]
  heartbeatRowCapExceeded?: boolean
  printRowCapExceeded?: boolean
  segmentCap?: number
  onlineWindowMs?: number
}


export function carryContext<A extends object, B extends object>(before: A, next: B): A & B {
  return Object.defineProperties({ ...before, ...next }, { ...Object.getOwnPropertyDescriptors(before), ...Object.getOwnPropertyDescriptors(next) })
}
