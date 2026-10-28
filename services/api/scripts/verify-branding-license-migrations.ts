/**
 * verify:branding-license-migrations —— 贴牌与授权两份迁移，SQLite 与 PostgreSQL 各自在隔离库上真跑一遍。
 *
 * 做法（同 verify-first-order-migrations）：按 main 上线前的 schema 建库，写入一个哨兵机构和哨兵终端，
 * 再用 prisma db execute 依次执行 20261028230000_organization_branding 与 20261028230100_license，然后核对：
 *   1. 升级不丢数据：哨兵机构与终端原样在；已有机构 licenseMode 落在 none，品牌覆盖三项为 null（不影响任何现有点位）。
 *   2. 新表可用：BrandLogo、License 能建行；默认值（status active、宽限 7 天）生效；storageKey 唯一。
 *   3. 库里的 CHECK 兜底真的挡得住：licenseMode 非法值、status 非法值、台数 0 / 10001、宽限 -1 / 31、止期不晚于起期。
 *   4. 外键 Restrict：有授权的机构删不掉。
 *   5. 零漂移：执行完迁移的库与当前 schema 之间 prisma migrate diff 没有差异（手写的迁移 SQL 与模型逐项对得上）。
 * PostgreSQL 用 initdb / pg_ctl 自己起一个临时实例（只监听 127.0.0.1），用完停掉并删目录。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:branding-license-migrations（需要 initdb / pg_ctl 在 PATH 上）
 */
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createPrismaClient } from '../src/prisma/create-client'

const api = resolve(__dirname, '..')
const prismaCli = join(api, 'node_modules/prisma/build/index.js')
const migrations = ['20261028230000_organization_branding', '20261028230100_license']
/** 贴牌与授权上线前的 main（本分支的切出点）。CI 的 checkout 是 fetch-depth: 0，这个提交一直在。 */
const baseline = '9a9563c37'
let failures = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}
function check(message: string, ok: boolean, detail = ''): void {
  if (ok) pass(message)
  else {
    failures += 1
    console.error(`  FAIL ${message}${detail ? ` — ${detail}` : ''}`)
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())))
  return port
}

async function rejects(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work()
    return false
  } catch {
    return true
  }
}

async function verify(kind: 'sqlite' | 'postgres', directory: string, url: string): Promise<void> {
  console.log(`\n[${kind}]`)
  const source = kind === 'sqlite' ? 'prisma/schema.prisma' : 'prisma/postgres/schema.prisma'
  const config = kind === 'sqlite' ? 'prisma.config.ts' : 'prisma.postgres.config.ts'
  const before = join(directory, `${kind}-baseline.prisma`)
  writeFileSync(before, execFileSync('git', ['show', `${baseline}:services/api/${source}`], { cwd: api }))
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, POSTGRES_URL: url, DOTENV_CONFIG_PATH: join(directory, 'no-dotenv') }
  const run = (args: string[]) => execFileSync(process.execPath, [prismaCli, ...args], { cwd: api, env, timeout: 90_000, stdio: 'pipe' })
  run(['db', 'push', '--config', config, '--schema', before])
  const { client } = createPrismaClient(url)
  try {
    await client.$connect()
    // 升级前的库还没有新列，而新版 Prisma Client 的 create 会把新列的默认值也写进 INSERT，
    // 所以哨兵行用原生 SQL 写（只填没有库内默认值的必填列，其余走库内默认）。
    const stamp = kind === 'sqlite' ? `'2026-10-28T00:00:00.000+00:00'` : `TIMESTAMP '2026-10-28 00:00:00'`
    await client.$executeRawUnsafe(`INSERT INTO "Organization" ("id", "name", "type", "updatedAt") VALUES ('bl-sentinel-org', 'Migration sentinel', 'public_employment_service', ${stamp})`)
    await client.$executeRawUnsafe(`INSERT INTO "Terminal" ("id", "terminalCode", "agentToken", "deviceFingerprint", "lastSeenAt", "orgId") VALUES ('bl-sentinel-terminal', 'BL-SENTINEL', 'migration-only-no-device', 'migration', ${stamp}, 'bl-sentinel-org')`)
    const migrationDir = kind === 'sqlite' ? 'prisma/migrations' : 'prisma/postgres/migrations'
    for (const name of migrations) run(['db', 'execute', '--config', config, '--file', join(api, migrationDir, name, 'migration.sql')])

    const org = await client.organization.findUnique({ where: { id: 'bl-sentinel-org' } })
    check('升级不丢数据：哨兵机构与终端还在', !!org && (await client.terminal.count({ where: { id: 'bl-sentinel-terminal', orgId: 'bl-sentinel-org' } })) === 1)
    check('已有机构 licenseMode 落在 none（不影响任何现有点位）', org?.licenseMode === 'none')
    check('已有机构的品牌覆盖三项都是 null', org?.brandName === null && org?.brandMark === null && org?.brandLogoAssetId === null)
    check('新表是空的', (await client.license.count()) === 0 && (await client.brandLogo.count()) === 0)

    const logo = await client.brandLogo.create({ data: { id: 'a'.repeat(32), storageKey: 'admin/uploads/a.png', mimeType: 'image/png', sizeBytes: 10, sha256: 'x', width: 64, height: 64 } })
    check('BrandLogo 能建行', logo.id === 'a'.repeat(32))
    check('BrandLogo.storageKey 唯一', await rejects(() => client.brandLogo.create({ data: { id: 'b'.repeat(32), storageKey: 'admin/uploads/a.png', mimeType: 'image/png', sizeBytes: 10, sha256: 'x', width: 64, height: 64 } })))

    const valid = { orgId: 'bl-sentinel-org', licenseeName: '迁移门禁企业', creditCode: '91330100799655058B', contractNo: 'HT-MIG-1', startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2027-11-01T00:00:00Z'), terminalQuota: 3, createdBy: 'migration' }
    const license = await client.license.create({ data: valid })
    check('License 能建行，默认值生效（status active、宽限 7 天）', license.status === 'active' && license.graceDays === 7)
    const bad: Array<[string, Record<string, unknown>]> = [
      ['status 非法值', { status: 'bogus' }], ['台数 0', { terminalQuota: 0 }], ['台数 10001', { terminalQuota: 10001 }],
      ['宽限 -1 天', { graceDays: -1 }], ['宽限 31 天', { graceDays: 31 }],
      ['止期等于起期', { endsAt: valid.startsAt }], ['止期早于起期', { endsAt: new Date('2026-10-01T00:00:00Z') }],
    ]
    for (const [label, over] of bad) {
      check(`CHECK 兜底挡住：${label}`, await rejects(() => client.license.create({ data: { ...valid, contractNo: `HT-BAD-${label}`, ...over } as never })))
    }
    check('CHECK 兜底挡住：licenseMode 非法值', await rejects(() => client.organization.update({ where: { id: 'bl-sentinel-org' }, data: { licenseMode: 'weird' } })))
    await client.organization.update({ where: { id: 'bl-sentinel-org' }, data: { licenseMode: 'required' } })
    check('licenseMode 可以改成 required', (await client.organization.findUniqueOrThrow({ where: { id: 'bl-sentinel-org' } })).licenseMode === 'required')
    check('外键 Restrict：有授权的机构删不掉', await rejects(() => client.organization.delete({ where: { id: 'bl-sentinel-org' } })))
    check('被拒的坏数据一条都没写进去', (await client.license.count()) === 1)
    await client.license.delete({ where: { id: license.id } })

    // 零漂移：执行完迁移的库与当前 schema 之间没有差异
    const target = join(api, source)
    try {
      run(['migrate', 'diff', '--config', config, '--from-config-datasource', '--to-schema', target, '--exit-code'])
      pass('执行完两份迁移的库与当前 schema 零漂移（prisma migrate diff）')
    } catch (error) {
      const out = String((error as { stdout?: Buffer }).stdout ?? '') + String((error as { stderr?: Buffer }).stderr ?? '')
      check('执行完两份迁移的库与当前 schema 零漂移（prisma migrate diff）', false, out.slice(0, 1500))
    }
  } finally {
    await client.$disconnect()
  }
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') throw new Error('Refusing migration verification in production')
  const directory = mkdtempSync(join(tmpdir(), 'verify-bl-migrations-'))
  // 短路径：本地套接字路径有长度上限，临时 PG 只走 TCP（-k 指向这个短目录）。
  const pgDirectory = mkdtempSync('/tmp/verify-bl-mig-pg-')
  const pgData = join(pgDirectory, 'data')
  let startAttempted = false
  const pgEnv = { ...process.env, LC_ALL: process.env['LC_ALL'] ?? 'C' }
  try {
    const database = join(directory, 'verify-bl-migrations.db')
    closeSync(openSync(database, 'a', 0o600))
    await verify('sqlite', directory, `file:${database}`)
    const port = await freePort()
    execFileSync('initdb', ['-D', pgData, '-A', 'trust', '-U', 'bl_verify', '--no-locale'], { timeout: 30_000, stdio: 'pipe', env: pgEnv })
    startAttempted = true
    execFileSync('pg_ctl', ['-D', pgData, '-l', join(pgDirectory, 'server.log'), '-o', `-h 127.0.0.1 -k ${pgDirectory} -p ${port} -F`, '-w', '-t', '20', 'start'], { timeout: 25_000, stdio: 'pipe', env: pgEnv })
    await verify('postgres', directory, `postgresql://bl_verify@127.0.0.1:${port}/postgres`)
  } finally {
    if (startAttempted && existsSync(join(pgData, 'postmaster.pid'))) {
      execFileSync('pg_ctl', ['-D', pgData, '-m', 'fast', '-w', '-t', '20', 'stop'], { timeout: 25_000, stdio: 'pipe', env: pgEnv })
    }
    rmSync(pgDirectory, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  }
  if (failures > 0) {
    console.error(`\nverify:branding-license-migrations FAIL：${failures} 项未通过`)
    process.exit(1)
  }
  console.log('\nverify:branding-license-migrations PASS：SQLite 与 PostgreSQL 升级保数据、新表可用、CHECK 兜底有效、零漂移')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration verification failed')
  process.exitCode = 1
})
