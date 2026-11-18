/**
 * Real Nest HTTP for POST /trtc/session and POST /trtc/session/stop.
 *
 * Creating a conversation bills Tencent Cloud. The route must run
 * TerminalIdentityGuard: no terminal session is 401 and TrtcService is not
 * called; a session for an enabled terminal is allowed; a disabled terminal
 * is rejected. Stop keeps the random capability token and must stay reachable
 * without a terminal session, including after the terminal is disabled.
 *
 * In-memory doubles only. No Redis server, database, or Tencent API.
 * Spawned by verify:trtc-ownership.
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import path from 'node:path'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { PrismaService } from '../src/prisma/prisma.service'
import { LlmConfigService } from '../src/ai/llm/llm-config.service'
import { TrtcController } from '../src/trtc/trtc.controller'
import { TrtcService } from '../src/trtc/trtc.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import {
  TERMINAL_TOKEN_VALIDATOR,
  TerminalSessionService,
} from '../src/terminals/terminal-session.service'

function routeBlock(source: string, decorator: string): string {
  const match = new RegExp(`${decorator}([\\s\\S]*?)(?=\\n\\s*@(?:Get|Post|Put|Patch|Delete)\\(|$)`).exec(source)
  return match?.[0] ?? ''
}

const TRTC_FIXTURE: Record<string, string> = {
  TRTC_SDK_APP_ID: '1400000001',
  TRTC_SDK_SECRET_KEY: 'verify-trtc-sdk-key-not-real',
  TENCENT_SECRET_ID: 'verify-tencent-id-not-real',
  TENCENT_SECRET_KEY: 'verify-tencent-key-not-real',
  TRTC_LLM_API_KEY: 'verify-trtc-llm-key-not-real',
  TRTC_TTS_CONFIG_JSON: '{"TTSType":"tencent"}',
}

function installTrtcFixture(): () => void {
  const saved = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(TRTC_FIXTURE)) {
    saved.set(key, process.env[key])
    process.env[key] = value
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function main(): Promise<void> {
  const restoreTrtc = installTrtcFixture()
  const root = path.resolve(__dirname, '..')
  const controllerSource = readFileSync(path.join(root, 'src/trtc/trtc.controller.ts'), 'utf8')
  const moduleSource = readFileSync(path.join(root, 'src/trtc/trtc.module.ts'), 'utf8')
  const startBlock = routeBlock(controllerSource, "@Post\\('session'\\)")
  const stopBlock = routeBlock(controllerSource, "@Post\\('session/stop'\\)")
  assert.match(startBlock, /@UseGuards\(TerminalIdentityGuard\)/, 'POST /trtc/session must use TerminalIdentityGuard')
  assert.doesNotMatch(stopBlock, /@UseGuards\(TerminalIdentityGuard\)/, 'POST /trtc/session/stop must stay open to the capability token')
  assert.match(moduleSource, /TerminalsModule/, 'TrtcModule must import TerminalsModule so the guard can be constructed')
  assert.match(moduleSource, /AiModule/, 'TrtcModule must import AiModule so the digital_human switch can be read')
  assert.match(moduleSource, /AiAccessModule/, 'TrtcModule must import AiAccessModule so pause and budget use the same check')
  // 启用位不再写在控制器里：能力表和建会话共用 digitalHumanVerdict，里面才读 getConfig('digital_human')。
  // 控制器留一份 getConfig 字面量会变成第二套判断，所以这里改断言共用函数。
  assert.match(startBlock, /digitalHumanVerdict\(/, 'POST /trtc/session must use the shared digital-human verdict before a billed session')
  assert.doesNotMatch(startBlock, /getConfig\('digital_human'\)/, 'enable bit stays inside the shared verdict, not a second copy on the route')

  const terminalA = 'trtc_http_terminal_a'
  let digitalHumanEnabled = true
  const data = new Map<string, string>()
  let terminalEnabled = true
  const started: string[] = []
  const stopped: string[] = []
  const redis = {
    async get(key: string) { return data.get(key) ?? null },
    async getDel(key: string) {
      const value = data.get(key) ?? null
      data.delete(key)
      return value
    },
    async setEx(key: string, _ttl: number, value: string) { data.set(key, value) },
    async del(key: string) {
      const had = data.delete(key)
      return had ? 1 : 0
    },
  }
  const prisma = {
    terminal: {
      async findUnique({ where }: { where: { id: string } }) {
        return where.id === terminalA
          ? { enabled: terminalEnabled, credentialGeneration: 1 }
          : null
      },
    },
  }
  const trtc = {
    async startSession(userId: string) {
      started.push(userId)
      return {
        taskId: 'tencent-real-task',
        sdkAppId: 0,
        userId,
        userSig: 'stub',
        roomId: 'room',
        expireTime: 0,
      }
    },
    async stopSession(taskId: string) { stopped.push(taskId) },
  }

  @Module({
    controllers: [TrtcController],
    providers: [
      TerminalIdentityGuard,
      TerminalSessionService,
      { provide: RedisService, useValue: redis },
      { provide: PrismaService, useValue: prisma },
      { provide: TrtcService, useValue: trtc },
      { provide: LlmConfigService, useValue: { getConfig: () => ({ enabled: digitalHumanEnabled }) } },
      {
        provide: TERMINAL_TOKEN_VALIDATOR,
        useValue: {
          async validateTerminalToken(id: string, authorization: string | undefined) {
            assert.equal(id, terminalA)
            assert.equal(authorization, 'Bearer trtc_http_fixture_agent')
          },
        },
      },
    ],
  })
  class FixtureModule {}

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  let passed = 0
  try {
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new HttpExceptionFilter())
    const sessions = app.get(TerminalSessionService)
    const boot = await sessions.createBootTicket(terminalA, 'Bearer trtc_http_fixture_agent')
    const { sessionToken } = await sessions.exchangeBootTicket(boot.bootTicket)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    const base = `http://127.0.0.1:${address.port}/api/v1/trtc/session`
    const validHeaders = {
      'content-type': 'application/json',
      'x-terminal-id': terminalA,
      'x-terminal-session-token': sessionToken,
    }

    async function post(url: string, headers: Record<string, string>, body: unknown) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      const payload = await response.json() as { error?: { code?: string; message?: string }; taskId?: string; ok?: boolean }
      return { response, payload }
    }

    {
      const before = started.length
      const { response, payload } = await post(base, { 'content-type': 'application/json', 'x-terminal-id': terminalA }, {})
      assert.equal(response.status, 401, 'missing terminal session')
      assert.equal(payload.error?.code, 'TERMINAL_SESSION_INVALID')
      assert.equal(started.length, before, 'missing session must not open a billed conversation')
      passed += 1
      console.log('PASS POST /trtc/session missing terminal session -> 401')
    }

    {
      digitalHumanEnabled = false
      const before = started.length
      const { response, payload } = await post(base, validHeaders, {})
      assert.equal(response.status, 503, 'digital_human off')
      assert.equal(payload.error?.code, 'AI_PAUSED')
      assert.equal(payload.error?.message, 'AI 服务暂停中，打印扫描照常')
      assert.equal(started.length, before, 'disabled digital_human must not open a billed conversation')
      digitalHumanEnabled = true
      passed += 1
      console.log('PASS POST /trtc/session digital_human off -> 503 AI_PAUSED')
    }

    let stopToken = ''
    {
      const { response, payload } = await post(base, validHeaders, {})
      assert.equal(response.status, 200, 'valid terminal session')
      assert.equal(started.length, 1, 'valid session reaches TrtcService.startSession once')
      assert.equal(typeof payload.taskId, 'string')
      assert.notEqual(payload.taskId, 'tencent-real-task')
      stopToken = payload.taskId ?? ''
      passed += 1
      console.log('PASS POST /trtc/session valid terminal session -> 200')
    }

    {
      terminalEnabled = false
      const before = started.length
      const { response, payload } = await post(base, validHeaders, {})
      assert.equal(response.status, 401, 'disabled terminal')
      assert.equal(payload.error?.code, 'TERMINAL_SESSION_INVALID')
      assert.equal(started.length, before, 'disabled terminal must not open a billed conversation')
      passed += 1
      console.log('PASS POST /trtc/session disabled terminal -> 401')
    }

    {
      const { response, payload } = await post(`${base}/stop`, { 'content-type': 'application/json' }, { taskId: stopToken })
      assert.equal(response.status, 401, 'stop still requires a terminal id')
      assert.equal(payload.error?.code, 'TERMINAL_ID_REQUIRED')
      assert.equal(stopped.length, 0)
      passed += 1
      console.log('PASS POST /trtc/session/stop missing terminal id -> 401')
    }

    {
      const { response, payload } = await post(
        `${base}/stop`,
        { 'content-type': 'application/json', 'x-terminal-id': terminalA },
        { taskId: stopToken },
      )
      assert.equal(response.status, 200, 'stop without a terminal session')
      assert.equal(payload.ok, true)
      assert.deepEqual(stopped, ['tencent-real-task'])
      passed += 1
      console.log('PASS POST /trtc/session/stop capability token without terminal session -> 200')
    }

    assert.equal(passed, 6)
  } finally {
    restoreTrtc()
    await app.close()
  }
  console.log('ALL PASS trtc terminal identity HTTP')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
