import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createPrismaClient } from '../src/prisma/create-client'

const api = resolve(__dirname, '..')
const prismaCli = join(api, 'node_modules/prisma/build/index.js')
const migration = '20261022080000_first_order_delivery/migration.sql'
const scanDeviceMigration = '20261102230000_add_scan_device_session_fields/migration.sql'
const scanDeviceRoundMigration = '20261103030000_add_scan_device_round/migration.sql'
const baseline = '07f9046c2'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))
  return port
}

async function verify(kind: 'sqlite' | 'postgres', directory: string, url: string) {
  const source = kind === 'sqlite' ? 'prisma/schema.prisma' : 'prisma/postgres/schema.prisma'
  const config = kind === 'sqlite' ? 'prisma.config.ts' : 'prisma.postgres.config.ts'
  const before = join(directory, `${kind}-baseline.prisma`)
  writeFileSync(before, execFileSync('git', ['show', `${baseline}:services/api/${source}`], { cwd: api }))
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, POSTGRES_URL: url, DOTENV_CONFIG_PATH: join(directory, 'no-dotenv') }
  const run = (args: string[]) => execFileSync(process.execPath, [prismaCli, ...args], { cwd: api, env, timeout: 60_000, stdio: 'pipe' })
  run(['db', 'push', '--config', config, '--schema', before])
  const { client } = createPrismaClient(url)
  try {
    await client.$connect()
    await client.organization.create({ data: { id: 'first-order-migration-sentinel', name: 'Migration sentinel', type: 'public_employment_service' } })
    // 基线之后的每条迁移都要在这里按顺序补一行；漏一条，下面用当前客户端写库就会报缺列。
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', migration)])
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', '20261028120000_ai_service_fact/migration.sql')])
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', '20261102090000_add_terminal_daily_free_print_sides/migration.sql')])
    // 屏上扫描会话字段（20261102230000，排在上一条之后）。升级前已有的扫描任务升级后要取默认值：此时库里的 ScanTask 还是旧结构，
    // 而当前客户端的模型已含新列，所以旧行只能用原生 SQL 写，且必须在执行这条迁移之前写；扫描任务要挂在终端下，先建一个专用终端。
    const legacyScanId = 'legacy-scan-before-device-fields'
    await client.terminal.create({ data: { id: 'scan-device-legacy-terminal', terminalCode: 'SCAN-DEVICE-LEGACY', agentToken: 'migration-only-no-device-legacy', deviceFingerprint: 'migration' } })
    await client.$executeRawUnsafe(`INSERT INTO "ScanTask" ("id", "terminalId", "scanType", "status", "expiresAt", "updatedAt") VALUES ('${legacyScanId}', 'scan-device-legacy-terminal', 'document', 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', scanDeviceMigration)])
    // 屏上扫描轮次（20261103030000，排在会话字段之后）。旧行取 0。必须在当前客户端写 ScanTask 之前执行。
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', scanDeviceRoundMigration)])
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', '20261104150000_add_terminal_heartbeat_printer_queue/migration.sql')])
    await client.aiServiceFact.create({ data: { serviceType: 'resume_optimize', serviceKey: 'migration-test', orgId: 'org-snapshot', terminalId: 'terminal-snapshot' } })
    if (await client.aiServiceFact.count() !== 1) throw new Error(`${kind}: fact table unavailable`)
    const sentinel = await client.organization.findUnique({ where: { id: 'first-order-migration-sentinel' } })
    if (!sentinel) throw new Error(`${kind}: baseline data was lost`)
    const counts = await Promise.all([client.serviceProject.count(), client.serviceDeployment.count(), client.serviceIncident.count(), client.serviceIncidentEvent.count(), client.serviceReport.count()])
    if (counts.some((n) => n !== 0)) throw new Error(`${kind}: expected five empty new tables`)
    const project = await client.serviceProject.create({ data: {
      orgId: sentinel.id, name: 'Migration project', reference: 'migration-1', serviceStartAt: new Date('2026-01-01T00:00:00Z'),
      serviceEndAt: new Date('2027-01-01T00:00:00Z'), serviceScope: 'Migration only', supportContact: 'Test support',
    } })
    await client.terminal.create({ data: { id: 'migration-terminal', terminalCode: 'MIGRATION-TERMINAL', agentToken: 'migration-only-no-device', deviceFingerprint: 'migration', orgId: sentinel.id } })
    const queueHeartbeat = await client.terminalHeartbeat.create({ data: {
      terminalId: 'migration-terminal',
      printerQueueName: 'Queue-A',
      printerQueuePortKind: 'usb',
      printerQueuePortName: 'USB001',
      printerQueueRawStatus: '3,0,False,0,0',
      printerQueueSpooler: 'running',
    } })
    const queueHeartbeatRead = await client.terminalHeartbeat.findUnique({ where: { id: queueHeartbeat.id } })
    if (
      queueHeartbeatRead?.printerQueueName !== 'Queue-A'
      || queueHeartbeatRead.printerQueuePortKind !== 'usb'
      || queueHeartbeatRead.printerQueuePortName !== 'USB001'
      || queueHeartbeatRead.printerQueueRawStatus !== '3,0,False,0,0'
      || queueHeartbeatRead.printerQueueSpooler !== 'running'
    ) throw new Error(`${kind}: printer queue heartbeat columns were not readable`)
    const deployment = await client.serviceDeployment.create({ data: {
      projectId: project.id, orgId: sentinel.id, terminalId: 'migration-terminal', activeTerminalId: 'migration-terminal', terminalCode: 'MIGRATION-TERMINAL', locationLabel: 'Test',
    } })
    let rejected = false
    try { await client.serviceDeployment.create({ data: { projectId: project.id, orgId: sentinel.id, terminalId: deployment.terminalId, activeTerminalId: deployment.terminalId, terminalCode: deployment.terminalCode, locationLabel: 'Duplicate' } }) }
    catch (e) { if ((e as { code?: string }).code === 'P2002') rejected = true; else throw e }
    if (!rejected) throw new Error(`${kind}: active deployment uniqueness missing`)
    await client.serviceDeployment.update({ where: { id: deployment.id }, data: { endedAt: new Date(), activeTerminalId: null } })
    await client.serviceDeployment.create({ data: { projectId: project.id, orgId: sentinel.id, terminalId: deployment.terminalId, activeTerminalId: deployment.terminalId, terminalCode: deployment.terminalCode, locationLabel: 'Next' } })
    console.log(`PASS ${kind}: upgrade preserves baseline data; five tables usable; active uniqueness and release verified`)

    // 屏上扫描会话字段（20261102230000，已在上面的迁移清单里按顺序执行）：升级前的旧行取默认值，新列可写；终端心跳新列可写。
    const [legacy] = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "startMode", "devicePageCount", "deviceSource", "deviceColorMode", "deviceState", "deviceErrorCode", "deviceUpdatedAt", "hardExpiresAt", "deviceRound" FROM "ScanTask" WHERE "id" = '${legacyScanId}'`)
    if (!legacy || legacy['startMode'] !== 'panel' || Number(legacy['devicePageCount']) !== 0) throw new Error(`${kind}: legacy scan row must default to panel / 0 pages`)
    for (const column of ['deviceSource', 'deviceColorMode', 'deviceState', 'deviceErrorCode', 'deviceUpdatedAt', 'hardExpiresAt']) {
      if (legacy[column] !== null) throw new Error(`${kind}: legacy scan row ${column} must stay NULL`)
    }
    if (legacy['deviceRound'] === null || legacy['deviceRound'] === undefined || Number(legacy['deviceRound']) !== 0) throw new Error(`${kind}: legacy scan row deviceRound must default to 0`)
    const plainScan = await client.scanTask.create({ data: { terminalId: 'migration-terminal', scanType: 'document', expiresAt: new Date(Date.now() + 600_000) } })
    if (plainScan.startMode !== 'panel' || plainScan.devicePageCount !== 0 || plainScan.deviceState !== null || plainScan.deviceRound !== 0) throw new Error(`${kind}: new scan row without device fields must default to panel / round 0`)
    await client.scanTask.update({ where: { id: plainScan.id }, data: { status: 'cancelled' } })
    const deviceScan = await client.scanTask.create({ data: {
      terminalId: 'migration-terminal', scanType: 'document', expiresAt: new Date(Date.now() + 600_000),
      startMode: 'device', deviceSource: 'feeder', deviceColorMode: 'gray', deviceState: 'ready', hardExpiresAt: new Date(Date.now() + 1_800_000),
    } })
    const deviceBack = await client.scanTask.findUnique({ where: { id: deviceScan.id } })
    if (deviceBack?.startMode !== 'device' || deviceBack.deviceSource !== 'feeder' || deviceBack.deviceColorMode !== 'gray' || deviceBack.deviceState !== 'ready' || !deviceBack.hardExpiresAt || deviceBack.deviceRound !== 0) throw new Error(`${kind}: device scan columns must be writable and readable`)
    const rounded = await client.scanTask.update({ where: { id: deviceScan.id }, data: { deviceRound: { increment: 1 } } })
    if (rounded.deviceRound !== 1) throw new Error(`${kind}: deviceRound must increment from the default 0`)
    const observedAt = new Date()
    await client.terminalHeartbeat.create({ data: { terminalId: 'migration-terminal', scanDeviceHealth: 'ready', scanDeviceObservedAt: observedAt } })
    const heartbeat = await client.terminalHeartbeat.findFirst({ where: { terminalId: 'migration-terminal' }, orderBy: { createdAt: 'desc' } })
    if (heartbeat?.scanDeviceHealth !== 'ready' || heartbeat.scanDeviceObservedAt?.getTime() !== observedAt.getTime()) throw new Error(`${kind}: heartbeat scan-device columns must round-trip`)
    console.log(`PASS ${kind}: scan device session columns — legacy rows default to panel, device rows and heartbeat health round-trip`)
    console.log(`PASS ${kind}: scan deviceRound defaults to 0 on legacy and new rows and can increment`)
  } finally { await client.$disconnect() }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing migration verification in production')
  const directory = mkdtempSync(join(tmpdir(), 'verify-first-order-migrations-'))
  // A short, task-owned Unix socket path; never reuse a system PostgreSQL server.
  const pgDirectory = mkdtempSync('/tmp/verify-fo-migrations-pg-')
  const pgData = join(pgDirectory, 'data')
  let startAttempted = false
  try {
    const database = join(directory, 'verify-first-order-migrations.db')
    closeSync(openSync(database, 'a', 0o600))
    await verify('sqlite', directory, `file:${database}`)
    const port = await freePort()
    execFileSync('initdb', ['-D', pgData, '-A', 'trust', '-U', 'first_order_verify', '--no-locale'], { timeout: 30_000, stdio: 'pipe' })
    startAttempted = true
    execFileSync('pg_ctl', ['-D', pgData, '-l', join(pgDirectory, 'server.log'), '-o', `-h 127.0.0.1 -k ${pgDirectory} -p ${port} -F`, '-w', '-t', '20', 'start'], { timeout: 25_000, stdio: 'pipe' })
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'first_order_verify', 'fresh'], { timeout: 30_000, stdio: 'pipe' })
    const freshUrl = `postgresql://first_order_verify@127.0.0.1:${port}/fresh`
    const freshEnv = { ...process.env, NODE_ENV: 'test', POSTGRES_URL: freshUrl, DATABASE_URL: freshUrl, DOTENV_CONFIG_PATH: join(directory, 'no-dotenv') }
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', 'prisma.postgres.config.ts'], { cwd: api, env: freshEnv, timeout: 120_000, stdio: 'pipe' })
    execFileSync(process.execPath, [prismaCli, 'migrate', 'diff', '--config', 'prisma.postgres.config.ts', '--from-config-datasource', '--to-schema', 'prisma/postgres/schema.prisma', '--exit-code'], { cwd: api, env: freshEnv, timeout: 120_000, stdio: 'pipe' })
    const { client: fresh } = createPrismaClient(freshUrl)
    try { await fresh.aiServiceFact.create({ data: { serviceType: 'mock_interview', serviceKey: 'fresh', orgId: 'org', terminalId: 'terminal' } }) } finally { await fresh.$disconnect() }
    console.log('PASS postgres: fresh migrations and schema diff; fact table usable')
    await verify('postgres', directory, `postgresql://first_order_verify@127.0.0.1:${port}/postgres`)
  } finally {
    if (startAttempted && existsSync(join(pgData, 'postmaster.pid'))) execFileSync('pg_ctl', ['-D', pgData, '-m', 'fast', '-w', '-t', '20', 'stop'], { timeout: 25_000, stdio: 'pipe' })
    rmSync(pgDirectory, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Migration verification failed'); process.exitCode = 1 })
