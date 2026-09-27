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

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..')
  const controllerSource = readFileSync(path.join(root, 'src/trtc/trtc.controller.ts'), 'utf8')
  const moduleSource = readFileSync(path.join(root, 'src/trtc/trtc.module.ts'), 'utf8')
  const startBlock = routeBlock(controllerSource, "@Post\\('session'\\)")
  const stopBlock = routeBlock(controllerSource, "@Post\\('session/stop'\\)")
  assert.match(startBlock, /@UseGuards\(TerminalIdentityGuard\)/, 'POST /trtc/session must use TerminalIdentityGuard')
  assert.doesNotMatch(stopBlock, /@UseGuards\(TerminalIdentityGuard\)/, 'POST /trtc/session/stop must stay open to the capability token')
  assert.match(moduleSource, /TerminalsModule/, 'TrtcModule must import TerminalsModule so the guard can be constructed')

  const terminalA = 'trtc_http_terminal_a'
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
      const payload = await response.json() as { error?: { code?: string }; taskId?: string; ok?: boolean }
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

    assert.equal(passed, 5)
  } finally {
    await app.close()
  }
  console.log('ALL PASS trtc terminal identity HTTP')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
