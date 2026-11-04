import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { HeartbeatDto } from '../src/terminals/dto/heartbeat.dto'
import { isAcceptablePrinterQueueName, printerQueueHeartbeatData, toAdminPrinterQueue } from '../src/terminals/heartbeat-printer-queue'

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
const helper = read('src/terminals/heartbeat-printer-queue.ts')
const agentService = read('src/terminals/terminals-agent.service.ts')
const adminService = read('src/terminals/terminals-admin.service.ts')

assert.match(dto, /export const PRINTER_QUEUE_PORT_KINDS = \['usb', 'network', 'wsd', 'other', 'unknown'\] as const/)
assert.match(dto, /export const PRINTER_QUEUE_SPOOLERS = \['running', 'stopped', 'other', 'unknown'\] as const/)
assert.match(dto, /@IsIn\(PRINTER_QUEUE_PORT_KINDS\)/)
assert.match(dto, /@IsIn\(PRINTER_QUEUE_SPOOLERS\)/)
assert.ok(helper.split('\n').length <= 150, 'heartbeat-printer-queue.ts must stay within 150 lines')

for (const forbidden of ['ssid', 'password', 'gateway', 'printerHostAddress', 'agentToken', 'bindCode']) {
  assert.equal(dto.toLowerCase().includes(forbidden.toLowerCase()), false, `DTO must not contain ${forbidden}`)
  assert.equal(helper.toLowerCase().includes(forbidden.toLowerCase()), false, `printer queue helper must not contain ${forbidden}`)
}

assert.match(agentService, /\.\.\.printerQueueHeartbeatData\(dto\),/)
assert.match(adminService, /\.\.\.PRINTER_QUEUE_HEARTBEAT_SELECT,/)
assert.match(adminService, /printerQueue: toAdminPrinterQueue\(hb\),/)
for (const column of columns) {
  assert.equal(agentService.includes(column), false, `agent service must only pass the helper through, found ${column}`)
  assert.equal(adminService.includes(column), false, `admin service must only pass the helper through, found ${column}`)
}
assert.doesNotMatch(agentService, /function printerQueueHeartbeatData|function toAdminPrinterQueue/)
assert.doesNotMatch(adminService, /function printerQueueHeartbeatData|function toAdminPrinterQueue/)
const printersAt = adminService.indexOf('async listPrintersForAdmin(')
assert.notEqual(printersAt, -1, 'listPrintersForAdmin must stay in place')
assert.doesNotMatch(adminService.slice(printersAt), /printerQueue/)

assert.deepEqual(printerQueueHeartbeatData({}), {
  printerQueueName: null,
  printerQueuePortKind: null,
  printerQueuePortName: null,
  printerQueueRawStatus: null,
  printerQueueSpooler: null,
})
assert.equal(printerQueueHeartbeatData({ printerQueueRawStatus: '3,,False,,' }).printerQueueRawStatus, '3,,False,,')
assert.equal(toAdminPrinterQueue(null), null)
assert.equal(toAdminPrinterQueue(undefined), null)
assert.equal(toAdminPrinterQueue({
  printerQueueName: null,
  printerQueuePortKind: null,
  printerQueuePortName: null,
  printerQueueRawStatus: null,
  printerQueueSpooler: null,
}), null)
assert.equal(toAdminPrinterQueue({
  printerQueueName: '',
  printerQueuePortKind: '',
  printerQueuePortName: '',
  printerQueueRawStatus: '',
  printerQueueSpooler: '',
}), null)
const partial = toAdminPrinterQueue({ printerQueueSpooler: 'stopped' })
assert.equal(partial?.printerQueueSpooler, 'stopped')
assert.equal(partial?.printerQueueRawStatus, null)

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
  assert.equal(printerQueueHeartbeatData(full).printerQueuePortName, 'USB001')

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
    if (label === 'port USB1') assert.equal(printerQueueHeartbeatData(parsed).printerQueuePortName, null)
  }

  const networkWithPortName = await accept(
    { printerQueuePortKind: 'network', printerQueuePortName: 'USB001' },
    'network kind keeps the request, drops the port name',
  )
  assert.equal(networkWithPortName.printerQueuePortKind, 'network')
  assert.equal(networkWithPortName.printerQueuePortName, 'USB001')
  assert.equal(printerQueueHeartbeatData(networkWithPortName).printerQueuePortKind, 'network')
  assert.equal(printerQueueHeartbeatData(networkWithPortName).printerQueuePortName, null)

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

  // 和终端程序门禁同一张表。长度按 UTF-16 码元：一个 😀 是 2 个码元。
  const acceptedQueueNames = [
    'Pantum CM2800ADN Series',
    'Pantum CM2800ADN Series (副本 1)',
    '奔图 CM2820 打印机',
    'Printer v1.2.3',
    'a'.repeat(128),
    '😀'.repeat(64),
  ]
  const rejectedQueueNames = [
    '',
    'a'.repeat(129),
    '😀'.repeat(65),
    'bad\nname',
    'bad\u007fname',
    'bad\u0085name',
    'bad\u009fname',
    '\\\\192.168.1.5\\Pantum',
    '\\\\PRINTSRV\\Pantum',
    'http://192.168.1.5:631/ipp/print',
    'ipp://printer.local/ipp',
    'Pantum 192.168.1.5',
    '192.168.001.005',
  ]
  for (const name of acceptedQueueNames) {
    assert.equal(isAcceptablePrinterQueueName(name), true, `function accept ${JSON.stringify(name)}`)
    const parsed = await accept({ printerQueueName: name }, `pipe accept ${JSON.stringify(name)}`)
    assert.equal(parsed.printerQueueName, name)
  }
  for (const name of rejectedQueueNames) {
    assert.equal(isAcceptablePrinterQueueName(name), false, `function reject ${JSON.stringify(name)}`)
    await reject({ printerQueueName: name }, `pipe reject ${JSON.stringify(name)}`)
  }

  console.log('PASS terminal printer queue: dual schema, five-column migration, enum heartbeat fields, passthrough only')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
