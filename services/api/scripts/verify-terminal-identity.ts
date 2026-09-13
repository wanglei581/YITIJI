/** Terminal boot-ticket/session gate: dynamic fixture verification without Prisma migration. */
import 'reflect-metadata'
import { UnauthorizedException } from '@nestjs/common'
import { ServiceUnavailableException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'

type Row = { enabled: boolean; credentialGeneration: number }

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }
function code(error: unknown): string | undefined {
  const response = error instanceof UnauthorizedException || error instanceof ServiceUnavailableException
    ? error.getResponse() as { error?: { code?: string } }
    : undefined
  return response?.error?.code
}

async function expectCode(label: string, expected: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (code(error) === expected) return pass(label)
    fail(`${label}: expected ${expected}, got ${code(error) ?? String(error)}`)
  }
  fail(`${label}: unexpectedly succeeded`)
}

function routeDecoratorBlock(source: string, decorator: string): string {
  const match = new RegExp(`${decorator}([\\s\\S]*?)(?=\\n\\s*@(?:Get|Post|Put|Patch|Delete)\\(|$)`).exec(source)
  return match?.[0] ?? ''
}

function pickupGuards(source: string): { claim: boolean; release: boolean; takeaway: boolean } {
  const hit = (decorator: string) => routeDecoratorBlock(source, decorator).includes('@UseGuards(TerminalIdentityGuard)')
  return {
    claim: hit("@Post\\('claim-pickup'\\)"),
    release: hit("@Post\\(':orderId/release'\\)"),
    takeaway: hit("@Post\\(':taskId/takeaway-url'\\)"),
  }
}

function assertPickupGuardMetadata(source: string, label: string): void {
  const found = pickupGuards(source)
  if (!found.claim || !found.release) {
    fail(`${label}: claim-pickup and :orderId/release must carry TerminalIdentityGuard (claim=${found.claim} release=${found.release})`)
  }
  if (found.takeaway) fail(`${label}: takeaway-url must NOT carry TerminalIdentityGuard`)
}

function expectPickupGuardMutationFails(source: string, label: string, expectedSubstring: string): void {
  try {
    assertPickupGuardMetadata(source, label)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedSubstring)) {
      fail(`${label}: failed for unexpected reason: ${message}`)
    }
    pass(label)
    return
  }
  fail(`${label}: expected guard-metadata check to fail`)
}

async function main(): Promise<void> {
  console.log('\n=== terminal identity dynamic verification ===')
  const data = new Map<string, string>()
  let redisFault = false
  const redis = {
    async get(key: string) { if (redisFault) throw new Error('redis unavailable'); return data.get(key) ?? null },
    async getDel(key: string) { if (redisFault) throw new Error('redis unavailable'); const value = data.get(key) ?? null; data.delete(key); return value },
    async setEx(key: string, _ttl: number, value: string) { if (redisFault) throw new Error('redis unavailable'); data.set(key, value) },
  }
  const rows = new Map<string, Row>([
    ['term_identity_a', { enabled: true, credentialGeneration: 7 }],
    ['term_identity_b', { enabled: true, credentialGeneration: 7 }],
  ])
  const prisma = {
    terminal: {
      async findUnique(input: { where: { id: string } }) { return rows.get(input.where.id) ?? null },
    },
  }
  const terminals = { async validateTerminalToken() { return undefined } }
  const sessions = new TerminalSessionService(redis as never, prisma as never, terminals as never)
  const guard = new TerminalIdentityGuard(sessions)

  const boot = await sessions.createBootTicket('term_identity_a', 'Bearer fixture')
  const session = await sessions.exchangeBootTicket(boot.bootTicket)
  await sessions.validate('term_identity_a', session.sessionToken)
  pass('Agent credential mints 60-second boot ticket and ticket exchanges for a session')

  await expectCode('ticket is single-use', 'TERMINAL_SESSION_INVALID', () => sessions.exchangeBootTicket(boot.bootTicket))
  await expectCode('missing token is 401', 'TERMINAL_SESSION_INVALID', () => sessions.validate('term_identity_a', undefined))
  await expectCode('wrong terminal id is 401', 'TERMINAL_SESSION_INVALID', () => sessions.validate('term_identity_b', session.sessionToken))

  const context = (terminalId: string | undefined, sessionToken: string | undefined, routeTerminalId?: string, bodyTerminalId?: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => name === 'x-terminal-id' ? terminalId : sessionToken,
        params: routeTerminalId ? { terminalId: routeTerminalId } : {},
        body: bodyTerminalId ? { terminalId: bodyTerminalId } : {},
      }),
    }),
  })
  for (const endpoint of [
    'POST /print/jobs',
    'POST /print/jobs/claim-pickup',
    'POST /print/jobs/:orderId/release',
    'GET /terminals/:id/config',
    'POST /terminals/:id/toolbox-events',
  ]) {
    await expectCode(`${endpoint} rejects a missing terminal session with 401`, 'TERMINAL_SESSION_INVALID', () => guard.canActivate(context('term_identity_a', undefined) as never))
  }
  await expectCode('protected endpoint guard rejects route/header terminal mismatch with 401', 'TERMINAL_SESSION_INVALID', () => guard.canActivate(context('term_identity_a', session.sessionToken, 'term_identity_b') as never))
  await expectCode('POST /print/jobs guard rejects body.terminalId that differs from the verified header (cross-terminal job injection)', 'TERMINAL_SESSION_INVALID', () => guard.canActivate(context('term_identity_a', session.sessionToken, undefined, 'term_identity_b') as never))
  if (await guard.canActivate(context('term_identity_a', session.sessionToken, undefined, 'term_identity_a') as never) !== true) {
    fail('guard must allow a body.terminalId equal to the verified header')
  }
  pass('guard allows body.terminalId equal to the verified header')

  const pickupCalls = { claim: 0, release: 0 }
  const pickupService = {
    claim: () => { pickupCalls.claim += 1 },
    release: () => { pickupCalls.release += 1 },
  }
  async function invokePickup(
    action: 'claim' | 'release',
    ctx: ReturnType<typeof context>,
  ): Promise<void> {
    await guard.canActivate(ctx as never)
    pickupService[action]()
  }
  function assertZeroPickupCalls(label: string): void {
    if (pickupCalls.claim !== 0 || pickupCalls.release !== 0) {
      fail(`${label}: service was called (claim=${pickupCalls.claim} release=${pickupCalls.release})`)
    }
  }

  for (const action of ['claim', 'release'] as const) {
    const route = action === 'claim' ? 'claim-pickup' : 'release'
    pickupCalls.claim = 0
    pickupCalls.release = 0
    await expectCode(
      `${route} missing terminal session rejects before service call`,
      'TERMINAL_SESSION_INVALID',
      () => invokePickup(action, context('term_identity_a', undefined)),
    )
    assertZeroPickupCalls(`${route} missing session`)
    await expectCode(
      `${route} invalid terminal session rejects before service call`,
      'TERMINAL_SESSION_INVALID',
      () => invokePickup(action, context('term_identity_a', 'not-a-session-token')),
    )
    assertZeroPickupCalls(`${route} invalid session`)
    await expectCode(
      `${route} header/session terminal mismatch rejects before service call`,
      'TERMINAL_SESSION_INVALID',
      () => invokePickup(action, context('term_identity_b', session.sessionToken)),
    )
    assertZeroPickupCalls(`${route} header mismatch`)
    await expectCode(
      `${route} body.terminalId mismatch rejects before service call`,
      'TERMINAL_SESSION_INVALID',
      () => invokePickup(action, context('term_identity_a', session.sessionToken, undefined, 'term_identity_b')),
    )
    assertZeroPickupCalls(`${route} body mismatch`)
    await invokePickup(action, context('term_identity_a', session.sessionToken))
    if (pickupCalls[action] !== 1) {
      fail(`${route}: verified terminal must reach the service exactly once, got ${pickupCalls[action]}`)
    }
    const other = action === 'claim' ? 'release' : 'claim'
    if (pickupCalls[other] !== 0) fail(`${route}: leaked a ${other} service call`)
    pass(`${route} verified session reaches service; missing/invalid/mismatch never do`)
  }

  data.delete(sessions.sessionKey(session.sessionToken))
  await expectCode('expired or deleted session is 401', 'TERMINAL_SESSION_INVALID', () => sessions.validate('term_identity_a', session.sessionToken))

  const rotationBoot = await sessions.createBootTicket('term_identity_a', 'Bearer fixture')
  const rotatedSession = await sessions.exchangeBootTicket(rotationBoot.bootTicket)
  rows.get('term_identity_a')!.credentialGeneration += 1
  await expectCode('credential generation rotation revokes old session immediately', 'TERMINAL_SESSION_INVALID', () => sessions.validate('term_identity_a', rotatedSession.sessionToken))

  const disabledBoot = await sessions.createBootTicket('term_identity_b', 'Bearer fixture')
  const disabledSession = await sessions.exchangeBootTicket(disabledBoot.bootTicket)
  rows.get('term_identity_b')!.enabled = false
  await expectCode('disabling terminal revokes old session immediately', 'TERMINAL_SESSION_INVALID', () => sessions.validate('term_identity_b', disabledSession.sessionToken))

  rows.get('term_identity_b')!.enabled = true
  redisFault = true
  await expectCode('Redis failure is retryable 503, never 401', 'TERMINAL_SESSION_RETRYABLE', () => sessions.validate('term_identity_b', disabledSession.sessionToken))
  redisFault = false

  const root = path.resolve(__dirname, '..')
  const printController = readFileSync(path.join(root, 'src/print-jobs/print-jobs.controller.ts'), 'utf8')
  const terminalsController = readFileSync(path.join(root, 'src/terminals/terminals.controller.ts'), 'utf8')
  const terminalSessionService = readFileSync(path.join(root, 'src/terminals/terminal-session.service.ts'), 'utf8')
  const protectedRoute = (source: string, decorator: string) =>
    routeDecoratorBlock(source, decorator).includes('@UseGuards(TerminalIdentityGuard)')
  if (!protectedRoute(printController, '@Post\\(\\)')
    || !protectedRoute(printController, "@Post\\('claim-pickup'\\)")
    || !protectedRoute(printController, "@Post\\(':orderId/release'\\)")
    || !protectedRoute(terminalsController, "@Get\\('terminals/:terminalId/config'\\)")
    || !protectedRoute(terminalsController, "@Post\\('terminals/:terminalId/toolbox-events'\\)")) {
    fail('all five protected endpoints must carry TerminalIdentityGuard')
  }
  pass('five protected endpoints carry TerminalIdentityGuard')
  assertPickupGuardMetadata(printController, 'production print controller')
  pass('claim-pickup and release carry TerminalIdentityGuard; takeaway-url does not')
  expectPickupGuardMutationFails(
    printController.replace(/@Post\('claim-pickup'\)[\s\S]*?@UseGuards\(TerminalIdentityGuard\)/, "@Post('claim-pickup')"),
    'mutation: dropping TerminalIdentityGuard on claim-pickup is caught',
    'claim-pickup and :orderId/release must carry TerminalIdentityGuard',
  )
  expectPickupGuardMutationFails(
    printController.replace(/@Post\(':orderId\/release'\)[\s\S]*?@UseGuards\(TerminalIdentityGuard\)/, "@Post(':orderId/release')"),
    'mutation: dropping TerminalIdentityGuard on :orderId/release is caught',
    'claim-pickup and :orderId/release must carry TerminalIdentityGuard',
  )
  expectPickupGuardMutationFails(
    printController.replace(/@Post\(':taskId\/takeaway-url'\)/, "@Post(':taskId/takeaway-url')\n  @UseGuards(TerminalIdentityGuard)"),
    'mutation: adding TerminalIdentityGuard on takeaway-url is caught',
    'takeaway-url must NOT carry TerminalIdentityGuard',
  )
  const guardSource = readFileSync(path.join(root, 'src/terminals/terminal-identity.guard.ts'), 'utf8')
  if (!/typeof bodyTerminalId === 'string' && bodyTerminalId !== terminalId/.test(guardSource)) {
    fail('TerminalIdentityGuard must reject a request body terminalId that differs from the verified x-terminal-id (cross-terminal print job injection)')
  }
  pass('guard binds body.terminalId to the verified terminal (no cross-terminal job injection)')
  if (!terminalSessionService.includes('term:boot:${ticket}') || !terminalSessionService.includes('term:session:${sessionToken}')) {
    fail('terminal session Redis keys must use term:boot and term:session namespaces')
  }
  if (!terminalSessionService.includes('getDel(key)')) {
    fail('boot tickets must be consumed with Redis GETDEL, not separate get/delete calls')
  }
  pass('boot ticket Redis namespaces and atomic one-time consumption are present')
  const publicRoute = (route: string) => new RegExp(`@Get\\('${route}'\\)[\\s\\S]{0,160}@UseGuards\\(TerminalIdentityGuard\\)`).test(terminalsController)
  if (publicRoute('terminals/:terminalId/printer-status') || publicRoute('terminals/:terminalId/capabilities')) {
    fail('printer-status and capabilities must remain public')
  }
  if (!terminalsController.includes("@Get('terminals/:terminalId/printer-status')")
    || !terminalsController.includes("@Get('terminals/:terminalId/capabilities')")) {
    fail('printer-status and capabilities routes must remain available')
  }
  pass('printer-status and capabilities remain public without a terminal session')
  console.log('ALL PASS')
}

void main().catch((error: unknown) => { console.error(error); process.exit(1) })
