import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { HeartbeatDto } from '../src/terminals/dto/heartbeat.dto'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const columns = [
  'printerQueueName',
  'printerQueuePortKind',
  'printerQueuePortName',
  'printerQueueRawStatus',
  'printerQueueSpooler',
] as const

for (const schemaPath of ['prisma/schema.prisma', 'prisma/postgres/schema.prisma']) {
  const source = read(schemaPath)
  const model = source.slice(source.indexOf('model TerminalHeartbeat'), source.indexOf('model AgentReleaseArtifact'))
  for (const column of columns) {
    assert.match(model, new RegExp(`${column}\\s+String\\?`), `${schemaPath} missing ${column}`)
  }
}

for (const migrationPath of [
  'prisma/migrations/20261104150000_add_terminal_heartbeat_printer_queue/migration.sql',
  'prisma/postgres/migrations/20261104150000_add_terminal_heartbeat_printer_queue/migration.sql',
]) {
  const migration = read(migrationPath)
  for (const column of columns) {
    assert.match(migration, new RegExp(`ADD COLUMN "${column}"`), `${migrationPath} missing ${column}`)
  }
  assert.equal((migration.match(/ADD COLUMN/g) ?? []).length, 5, `${migrationPath} must add exactly five columns`)
}

const dto = read('src/terminals/dto/heartbeat.dto.ts')

assert.match(dto, /export const PRINTER_QUEUE_PORT_KINDS = \['usb', 'network', 'wsd', 'other', 'unknown'\] as const/)
assert.match(dto, /export const PRINTER_QUEUE_SPOOLERS = \['running', 'stopped', 'other', 'unknown'\] as const/)
assert.match(dto, /@IsIn\(PRINTER_QUEUE_PORT_KINDS\)/)
assert.match(dto, /@IsIn\(PRINTER_QUEUE_SPOOLERS\)/)

for (const forbidden of ['ssid', 'password', 'gateway', 'printerHostAddress', 'agentToken', 'bindCode']) {
  assert.equal(dto.toLowerCase().includes(forbidden.toLowerCase()), false, `DTO must not contain ${forbidden}`)
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
const meta = { type: 'body' as const, metatype: HeartbeatDto, data: '' }

async function accept(body: Record<string, unknown>, label: string) {
  const parsed = await pipe.transform(body, meta)
  assert.equal(parsed instanceof HeartbeatDto, true, label)
  return parsed as HeartbeatDto
}

async function reject(body: Record<string, unknown>, label: string) {
  await assert.rejects(
    () => pipe.transform(body, meta),
    (error: unknown) => error instanceof BadRequestException,
    label,
  )
}

async function main() {
  const full = await accept({
    status: 'online',
    printerQueueName: '前台队列',
    printerQueuePortKind: 'usb',
    printerQueuePortName: 'USB001',
    printerQueueRawStatus: '3,0,False,0,0',
    printerQueueSpooler: 'running',
  }, 'full sample')
  assert.equal(full.printerQueueName, '前台队列')
  assert.equal(full.printerQueuePortName, 'USB001')
  assert.equal(full.printerQueueRawStatus, '3,0,False,0,0')

  const oldAgent = await accept({ status: 'online', printerStatus: 'ready' }, 'old agent')
  assert.equal(oldAgent.printerQueueName, undefined)
  assert.equal(oldAgent.printerQueueSpooler, undefined)

  for (const [label, body] of [
    ['port DOT4', { printerQueuePortKind: 'usb', printerQueuePortName: 'DOT4_001' }],
    ['port USB1', { printerQueuePortName: 'USB1' }],
    ['kind network', { printerQueuePortKind: 'network', printerQueueSpooler: 'running' }],
    ['kind wsd', { printerQueuePortKind: 'wsd' }],
    ['kind other', { printerQueuePortKind: 'other' }],
    ['kind unknown', { printerQueuePortKind: 'unknown', printerQueueSpooler: 'unknown' }],
    ['spooler stopped', { printerQueueSpooler: 'stopped' }],
    ['spooler other', { printerQueueSpooler: 'other' }],
    ['raw empty slots', { printerQueueRawStatus: '3,,False,,' }],
    ['raw not_found', { printerQueueRawStatus: 'not_found' }],
    ['raw query_failed', { printerQueueRawStatus: 'query_failed' }],
    ['name length 128', { printerQueueName: 'a'.repeat(128) }],
  ] as const) {
    const parsed = await accept({ ...body }, label)
    if ('printerQueueRawStatus' in body) assert.equal(parsed.printerQueueRawStatus, body.printerQueueRawStatus)
  }

  for (const [label, body] of [
    ['port address', { printerQueuePortName: '192.168.50.2' }],
    ['port address prefix', { printerQueuePortName: 'IP_192.168.50.2' }],
    ['port wsd name', { printerQueuePortName: 'WSD-1234' }],
    ['kind lan', { printerQueuePortKind: 'lan' }],
    ['spooler Running', { printerQueueSpooler: 'Running' }],
    ['raw abc', { printerQueueRawStatus: 'abc' }],
    ['raw Maybe', { printerQueueRawStatus: '3,0,Maybe,0,0' }],
    ['name newline', { printerQueueName: 'queue\nname' }],
    ['name length 129', { printerQueueName: 'a'.repeat(129) }],
    ['unknown field', { printerQueueName: '前台队列', printerHostAddress: '192.168.50.2' }],
  ] as const) {
    await reject({ ...body }, label)
  }

  console.log('PASS terminal printer queue: dual schema, five-column migration, enum heartbeat fields')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
