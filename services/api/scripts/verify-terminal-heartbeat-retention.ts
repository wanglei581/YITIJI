import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { PrismaService } from '../src/prisma/prisma.service'
import { HeartbeatDto } from '../src/terminals/dto/heartbeat.dto'
import { TerminalHeartbeatRetentionTask } from '../src/terminals/terminal-heartbeat-retention.task'

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  const tooLong = plainToInstance(HeartbeatDto, {
    status: 'x'.repeat(65),
    printerStatus: 'x'.repeat(129),
    locationLabel: 'x'.repeat(201),
  })
  assert.equal((await validate(tooLong)).length, 3, 'heartbeat string length limits must reject oversized values')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const terminalId = `verify-heartbeat-${suffix}`
  try {
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `VHR-${suffix}`,
        agentToken: `verify-token-${suffix}`,
        deviceFingerprint: `verify-fingerprint-${suffix}`,
      },
    })
    const now = new Date('2026-09-06T12:00:00.000Z')
    await prisma.terminalHeartbeat.createMany({ data: [
      { terminalId, status: 'old', createdAt: new Date('2026-08-07T11:59:59.000Z') },
      { terminalId, status: 'boundary', createdAt: new Date('2026-08-07T12:00:00.000Z') },
      { terminalId, status: 'recent', createdAt: new Date('2026-09-06T11:59:59.000Z') },
    ] })
    const result = await new TerminalHeartbeatRetentionTask(prisma).runOnce(now)
    assert.equal(result.deleted, 1)
    assert.equal(result.cutoff.toISOString(), '2026-08-07T12:00:00.000Z')
    const retained = await prisma.terminalHeartbeat.findMany({ where: { terminalId }, orderBy: { createdAt: 'asc' } })
    assert.deepEqual(retained.map((row) => row.status), ['boundary', 'recent'])
    console.log('PASS heartbeat DTO length limits and 30-day retention cutoff')
  } finally {
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.onModuleDestroy()
  }
}

void main()
