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
    await client.organization.create({ data: { id: 'first-order-migration-sentinel', name: 'Migration sentinel', type: 'public_employment_service' } })
    run(['db', 'execute', '--config', config, '--file', join(api, kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations', migration)])
    const sentinel = await client.organization.findUnique({ where: { id: 'first-order-migration-sentinel' } })
    if (!sentinel) throw new Error(`${kind}: baseline data was lost`)
    const counts = await Promise.all([client.serviceProject.count(), client.serviceDeployment.count(), client.serviceIncident.count(), client.serviceIncidentEvent.count(), client.serviceReport.count()])
    if (counts.some((n) => n !== 0)) throw new Error(`${kind}: expected five empty new tables`)
    const project = await client.serviceProject.create({ data: {
      orgId: sentinel.id, name: 'Migration project', reference: 'migration-1', serviceStartAt: new Date('2026-01-01T00:00:00Z'),
      serviceEndAt: new Date('2027-01-01T00:00:00Z'), serviceScope: 'Migration only', supportContact: 'Test support',
    } })
    await client.terminal.create({ data: { id: 'migration-terminal', terminalCode: 'MIGRATION-TERMINAL', agentToken: 'migration-only-no-device', deviceFingerprint: 'migration', orgId: sentinel.id } })
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
    await verify('postgres', directory, `postgresql://first_order_verify@127.0.0.1:${port}/postgres`)
  } finally {
    if (startAttempted && existsSync(join(pgData, 'postmaster.pid'))) execFileSync('pg_ctl', ['-D', pgData, '-m', 'fast', '-w', '-t', '20', 'stop'], { timeout: 25_000, stdio: 'pipe' })
    rmSync(pgDirectory, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Migration verification failed'); process.exitCode = 1 })
