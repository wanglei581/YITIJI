/**
 * 到机补价与明确没出纸自动退。临时 SQLite。
 * 密钥写在 import 之前：swc 会把 import 提前。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-pickup-arrival-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-pickup-arrival-terminal-action-secret-0123456789'
process.env['NODE_ENV'] = 'test'
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = resolve(__dirname, '..')

function pushSchema(url: string): void {
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' })
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'verify-pickup-arrival-'))
  const url = `file:${join(dir, 'verify-pickup-arrival.db')}`
  process.env['DATABASE_URL'] = url
  assertIsolatedVerificationDatabase()
  pushSchema(url)
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { runPickupArrivalPriceCases } = await import('./support/pickup-arrival-price-cases')
  const { runP2b8ChannelFaultCases } = await import('./support/pickup-arrival-p2b8-channel-fault-cases')
  const { runP2b8ChannelStepsCases } = await import('./support/pickup-arrival-p2b8-channel-steps-cases')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    await runPickupArrivalPriceCases(prisma, randomBytes(4).toString('hex'))
    await runP2b8ChannelFaultCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    await runP2b8ChannelStepsCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
    const { runP2b8VerifyRaceCases } = await import('./support/pickup-arrival-p2b8-verify-race-cases')
    await runP2b8VerifyRaceCases(prisma, { tag: randomBytes(4).toString('hex'), orderIds: [], taskIds: [] })
  } finally {
    await prisma.onModuleDestroy()
    rmSync(dir, { recursive: true, force: true })
  }
  console.log('verify:pickup-arrival-price ok')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
