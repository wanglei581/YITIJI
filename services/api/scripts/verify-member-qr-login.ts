/**
 * member-auth QR ticket login — backend E2E verification.
 *
 * Flow:
 *   kiosk creates a QR ticket -> phone confirms with SMS code -> kiosk claims
 *   the member token exactly once.
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from '../src/app.module'
import { hashPhone } from '../src/common/crypto/phone-identity'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): void { console.error(`  FAIL ${message}`); process.exitCode = 1 }
function info(message: string): void { console.log(`  INFO ${message}`) }

function flatten(errors: ValidationError[], parent = ''): string[] {
  const output: string[] = []
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) output.push(...Object.values(error.constraints).map((message) => `${path}: ${message}`))
    if (error.children?.length) output.push(...flatten(error.children, path))
  }
  return output
}

interface Json { [key: string]: unknown }

async function main(): Promise<void> {
  console.log('\n=== member-auth QR ticket login — backend E2E verification ===')

  const jwtSecret = process.env['JWT_SECRET'] ?? ''
  if (jwtSecret.length < 16) { fail('JWT_SECRET missing or shorter than 16 chars'); process.exit(1) }
  if ((process.env['SECRET_ENCRYPTION_KEY'] ?? '').length < 32) { fail('SECRET_ENCRYPTION_KEY missing or shorter than 32 chars'); process.exit(1) }
  if (!process.env['REDIS_URL']) { fail('REDIS_URL missing'); process.exit(1) }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: flatten(errors)[0] ?? '请求参数校验失败', details: flatten(errors) },
      }),
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0)
  const url = await app.getUrl()
  const base = `${url.replace('[::1]', '127.0.0.1')}/api/v1/member`
  info(`HTTP listening: ${base}`)

  const redis = app.get(RedisService)
  const prisma = app.get(PrismaService)
  const tail = Date.now().toString().slice(-8)
  const phone = `138${tail}`
  const phoneHash = hashPhone(phone)
  const terminalId = `term_qr_${randomBytes(5).toString('hex')}`
  const otherTerminalId = `term_qr_${randomBytes(5).toString('hex')}`
  const agentToken = `qr-agent-token-${randomBytes(8).toString('hex')}`
  const otherAgentToken = `qr-agent-token-${randomBytes(8).toString('hex')}`
  const terminalHeaders = { authorization: `Bearer ${agentToken}`, 'x-terminal-id': terminalId }
  const otherTerminalHeaders = { authorization: `Bearer ${otherAgentToken}`, 'x-terminal-id': otherTerminalId }
  let ticketId: string | null = null

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: Json,
    headers?: Record<string, string>,
  ): Promise<{ status: number; json: Json }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(headers ?? {}),
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    })
    const json = (await response.json().catch(() => ({}))) as Json
    return { status: response.status, json }
  }

  try {
    await prisma.endUser.deleteMany({ where: { phoneHash } })
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalId, otherTerminalId] } } })
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `QR-${terminalId}`, agentToken, deviceFingerprint: `fp-${terminalId}` },
    })
    await prisma.terminal.create({
      data: {
        id: otherTerminalId,
        terminalCode: `QR-${otherTerminalId}`,
        agentToken: otherAgentToken,
        deviceFingerprint: `fp-${otherTerminalId}`,
      },
    })

    console.log('\n-- 1. create QR ticket ------------------------------------------------')
    const unauthCreate = await request('POST', '/auth/qr/create', { returnTo: '/me' })
    unauthCreate.status === 401
      ? pass('create without terminal auth -> 401')
      : fail(`create without terminal auth -> ${unauthCreate.status} ${JSON.stringify(unauthCreate.json)}`)

    const badProtocol = await request('POST', '/auth/qr/create', { returnTo: '//evil.example/path' }, terminalHeaders)
    badProtocol.status === 400
      ? pass('returnTo rejects protocol-relative external path')
      : fail(`returnTo protocol-relative path -> ${badProtocol.status} ${JSON.stringify(badProtocol.json)}`)

    const badBackslash = await request('POST', '/auth/qr/create', { returnTo: '/safe\\evil' }, terminalHeaders)
    badBackslash.status === 400
      ? pass('returnTo rejects backslash')
      : fail(`returnTo backslash -> ${badBackslash.status} ${JSON.stringify(badBackslash.json)}`)

    const badEmbeddedUrl = await request('POST', '/auth/qr/create', { returnTo: '/https://evil.example/path' }, terminalHeaders)
    badEmbeddedUrl.status === 400
      ? pass('returnTo rejects embedded URL')
      : fail(`returnTo embedded URL -> ${badEmbeddedUrl.status} ${JSON.stringify(badEmbeddedUrl.json)}`)

    const create = await request('POST', '/auth/qr/create', {
      deviceId: 'kiosk-e2e-01',
      deviceLabel: '测试一体机 01',
      returnTo: '/me',
    }, terminalHeaders)
    const created = (create.json.data ?? {}) as Json
    ticketId = created.ticketId as string | null
    const claimToken = created.claimToken as string | undefined
    if (create.status === 201 && ticketId && claimToken && typeof created.qrUrl === 'string' && created.expiresInSeconds === 180) {
      pass('create -> 201 with ticketId, claimToken, qrUrl, and 180s TTL')
    } else {
      fail(`create -> ${create.status} ${JSON.stringify(create.json)}`)
      return
    }
    ;(created.qrUrl as string).includes(encodeURIComponent(ticketId))
      ? pass('qrUrl contains ticketId')
      : fail(`qrUrl missing ticketId: ${created.qrUrl}`)
    !(created.qrUrl as string).includes(claimToken)
      ? pass('qrUrl does not expose claimToken')
      : fail('qrUrl exposes claimToken')

    console.log('\n-- 2. pending status before confirmation ------------------------------')
    const pending = await request('GET', `/auth/qr/${encodeURIComponent(ticketId)}/status`)
    const pendingData = (pending.json.data ?? {}) as Json
    pending.status === 200 && pendingData.status === 'pending'
      ? pass('status -> pending')
      : fail(`status pending -> ${pending.status} ${JSON.stringify(pending.json)}`)
    pendingData.deviceLabel === '测试一体机 01'
      ? pass('status returns device label for phone confirmation')
      : fail(`status missing device label: ${JSON.stringify(pending.json)}`)
    const earlyClaim = await request('POST', `/auth/qr/${encodeURIComponent(ticketId)}/claim`, { claimToken }, terminalHeaders)
    earlyClaim.status === 401
      ? pass('claim before confirmation -> 401')
      : fail(`claim before confirmation -> ${earlyClaim.status} ${JSON.stringify(earlyClaim.json)}`)

    console.log('\n-- 3. SMS code and wrong-code confirmation -----------------------------')
    const send = await request('POST', '/auth/sms-code', { phone, deviceId: 'phone-e2e-01' })
    send.status === 201 ? pass('sms-code -> 201') : fail(`sms-code -> ${send.status} ${JSON.stringify(send.json)}`)
    const code = await redis.get(`member:sms:code:${phoneHash}`)
    code && /^\d{6}$/.test(code) ? info(`SMS code stored in Redis: ${code.slice(0, 2)}****`) : fail('SMS code not found in Redis')
    const wrong = await request('POST', `/auth/qr/${encodeURIComponent(ticketId)}/confirm`, {
      phone,
      code: code === '000000' ? '111111' : '000000',
      deviceId: 'phone-e2e-01',
    })
    wrong.status === 401
      ? pass('wrong SMS code confirmation -> 401')
      : fail(`wrong SMS code confirmation -> ${wrong.status} ${JSON.stringify(wrong.json)}`)

    console.log('\n-- 4. correct-code confirmation ---------------------------------------')
    const confirm = await request('POST', `/auth/qr/${encodeURIComponent(ticketId)}/confirm`, {
      phone,
      code,
      deviceId: 'phone-e2e-01',
    })
    const confirmData = (confirm.json.data ?? {}) as Json
    confirm.status === 201 && confirmData.status === 'confirmed'
      ? pass('correct SMS code confirmation -> confirmed')
      : fail(`correct SMS code confirmation -> ${confirm.status} ${JSON.stringify(confirm.json)}`)
    !JSON.stringify(confirm.json).includes(phone) ? pass('confirm response does not expose raw phone') : fail('confirm response exposes raw phone')
    !JSON.stringify(confirm.json).includes('token') ? pass('confirm response does not return member token') : fail('confirm response exposes token')

    const duplicateConfirm = await request('POST', `/auth/qr/${encodeURIComponent(ticketId)}/confirm`, {
      phone,
      code: '000000',
      deviceId: 'phone-e2e-01',
    })
    duplicateConfirm.status === 409
      ? pass('duplicate confirmation -> 409')
      : fail(`duplicate confirmation -> ${duplicateConfirm.status} ${JSON.stringify(duplicateConfirm.json)}`)

    console.log('\n-- 5. confirmed status hides member identity ---------------------------')
    const confirmed = await request('GET', `/auth/qr/${encodeURIComponent(ticketId)}/status`)
    const confirmedData = (confirmed.json.data ?? {}) as Json
    confirmed.status === 200 && confirmedData.status === 'confirmed'
      ? pass('status -> confirmed')
      : fail(`status confirmed -> ${confirmed.status} ${JSON.stringify(confirmed.json)}`)
    !JSON.stringify(confirmed.json).includes('phoneMasked')
      ? pass('status does not expose member identity')
      : fail(`status exposes member identity: ${JSON.stringify(confirmed.json)}`)

    console.log('\n-- 6. kiosk claims token exactly once ---------------------------------')
    const noTokenClaim = await request('POST', `/auth/qr/${encodeURIComponent(ticketId)}/claim`, undefined, terminalHeaders)
    noTokenClaim.status === 400
      ? pass('missing claimToken -> 400')
      : fail(`missing claimToken -> ${noTokenClaim.status} ${JSON.stringify(noTokenClaim.json)}`)
    const wrongTokenClaim = await request(
      'POST',
      `/auth/qr/${encodeURIComponent(ticketId)}/claim`,
      { claimToken: 'wrong-claim-token-000000000000000000000000' },
      terminalHeaders,
    )
    wrongTokenClaim.status === 401
      ? pass('wrong claimToken -> 401')
      : fail(`wrong claimToken -> ${wrongTokenClaim.status} ${JSON.stringify(wrongTokenClaim.json)}`)
    const wrongTerminalClaim = await request(
      'POST',
      `/auth/qr/${encodeURIComponent(ticketId)}/claim`,
      { claimToken },
      otherTerminalHeaders,
    )
    wrongTerminalClaim.status === 401
      ? pass('wrong terminal cannot claim ticket')
      : fail(`wrong terminal claim -> ${wrongTerminalClaim.status} ${JSON.stringify(wrongTerminalClaim.json)}`)
    const claim = await request('POST', `/auth/qr/${encodeURIComponent(ticketId)}/claim`, { claimToken }, terminalHeaders)
    const claimData = (claim.json.data ?? {}) as Json
    const token = claimData.token as string | undefined
    const user = (claimData.user ?? {}) as Json
    claim.status === 201 && token && user.phoneMasked === `138****${tail.slice(-4)}`
      ? pass('claim -> token and masked phone')
      : fail(`claim -> ${claim.status} ${JSON.stringify(claim.json)}`)
    !JSON.stringify(claim.json).includes(phone) ? pass('claim response does not expose raw phone') : fail('claim response exposes raw phone')

    console.log('\n-- 7. replay is rejected ----------------------------------------------')
    const replay = await request('POST', `/auth/qr/${encodeURIComponent(ticketId)}/claim`, { claimToken }, terminalHeaders)
    replay.status === 410
      ? pass('second claim -> 410')
      : fail(`second claim -> ${replay.status} ${JSON.stringify(replay.json)}`)

    console.log('\n-- 8. invalid and unknown tickets are rejected -------------------------')
    const malformed = await request('GET', '/auth/qr/not-a-real-ticket/status')
    malformed.status === 400
      ? pass('malformed ticket status -> 400')
      : fail(`malformed ticket status -> ${malformed.status} ${JSON.stringify(malformed.json)}`)
    const missing = await request('GET', '/auth/qr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/status')
    missing.status === 404
      ? pass('unknown ticket status -> 404')
      : fail(`unknown ticket status -> ${missing.status} ${JSON.stringify(missing.json)}`)
  } finally {
    console.log('\n-- cleanup -------------------------------------------------------------')
    await prisma.endUser.deleteMany({ where: { phoneHash } })
    await redis.del(`member:sms:code:${phoneHash}`)
    await redis.del(`member:sms:cooldown:${phoneHash}`)
    await redis.del(`member:sms:attempt:${phoneHash}`)
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalId, otherTerminalId] } } })
    if (ticketId) {
      await redis.del(`member:qr:${ticketId}`)
      await redis.del(`member:qr:claimed:${ticketId}`)
    }
    await app.close()
  }

  const exitCode = process.exitCode ?? 0
  console.log(`\n${'-'.repeat(60)}`)
  console.log(exitCode === 0 ? 'ALL PASS' : 'SOME CHECKS FAILED')
  console.log('-'.repeat(60))
  if (exitCode !== 0) process.exit(exitCode)
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
