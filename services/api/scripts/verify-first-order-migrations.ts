import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createPrismaClient } from '../src/prisma/create-client'

const api = resolve(__dirname, '..')
const prismaCli = join(api, 'node_modules/prisma/build/index.js')
const migration = '20261022080000_first_order_delivery/migration.sql'
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
    // 基线库（07f9046c2 的 schema）比当前 schema 少列：当前版 Prisma Client 的 create 会把后来新增的带默认值的列
    // （如 Organization.licenseMode）一起写进 INSERT，基线库里没有这些列就报错。所以哨兵机构用原生 SQL 写，
    // 只填没有库内默认值的必填列；读回时也只取 id。
    const stamp = kind === 'sqlite' ? `'2026-10-28T00:00:00.000+00:00'` : `TIMESTAMP '2026-10-28 00:00:00'`
    await client.$executeRawUnsafe(`INSERT INTO "Organization" ("id", "name", "type", "updatedAt") VALUES ('first-order-migration-sentinel', 'Migration sentinel', 'public_employment_service', ${stamp})`)
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', migration)])
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', '20261028120000_ai_service_fact/migration.sql')])
    await client.aiServiceFact.create({ data: { serviceType: 'resume_optimize', serviceKey: 'migration-test', orgId: 'org-snapshot', terminalId: 'terminal-snapshot' } })
    if (await client.aiServiceFact.count() !== 1) throw new Error(`${kind}: fact table unavailable`)
    const sentinel = await client.organization.findUnique({ where: { id: 'first-order-migration-sentinel' }, select: { id: true } })
    if (!sentinel) throw new Error(`${kind}: baseline data was lost`)
    const counts = await Promise.all([client.serviceProject.count(), client.serviceDeployment.count(), client.serviceIncident.count(), client.serviceIncidentEvent.count(), client.serviceReport.count()])
    if (counts.some((n) => n !== 0)) throw new Error(`${kind}: expected five empty new tables`)
    const project = await client.serviceProject.create({ data: {
      orgId: sentinel.id, name: 'Migration project', reference: 'migration-1', serviceStartAt: new Date('2026-01-01T00:00:00Z'),
      serviceEndAt: new Date('2027-01-01T00:00:00Z'), serviceScope: 'Migration only', supportContact: 'Test support',
    } })
    await client.terminal.create({ data: { id: 'migration-terminal', terminalCode: 'MIGRATION-TERMINAL', agentToken: 'migration-only-no-device', deviceFingerprint: 'migration', orgId: sentinel.id }, select: { id: true } })
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
