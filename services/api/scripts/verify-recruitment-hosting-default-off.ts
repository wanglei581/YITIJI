/**
 * 全新环境未设置 RECRUITMENT_CONTENT_HOSTING_ENABLED 时必须关闭。
 * 不靠验证脚本路径或 VERIFICATION_DATABASE_TARGET 打开。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:recruitment-hosting-default-off
 */
import 'dotenv/config'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { isRecruitmentContentHostingEnabled } from '../src/recruitment-hosting/recruitment-hosting'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(`FAIL ${message}`) }

async function main() {
  assertIsolatedVerificationDatabase()
  const sniffed = isRecruitmentContentHostingEnabled(
    { VERIFICATION_DATABASE_TARGET: 'isolated' },
    ['node', 'scripts/verify-recruitment-hosting-default-off.ts'],
  )
  if (sniffed) fail('1. 未设置变量时，验证入口或 isolated 标记仍被当成打开')
  pass('1. 未设置变量时，验证入口和 isolated 标记都不打开托管')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const sfx = randomBytes(4).toString('hex')
  const orgId = `org_def_${sfx}`
  const jobId = `job_def_${sfx}`
  async function cleanup() {
    await prisma.job.deleteMany({ where: { id: jobId } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
  }
  try {
    await cleanup()
    await prisma.organization.create({
      data: { id: orgId, name: '默认关闭探针机构', type: 'school', contentTrustStatus: 'active' },
    })
    await prisma.job.create({
      data: {
        id: jobId, sourceOrgId: orgId, externalId: `def-${sfx}`, sourceName: '探针',
        sourceUrl: 'https://example.com/default-off', title: '默认关闭探针岗位', company: '某公司', city: '青岛',
        reviewStatus: 'approved', publishStatus: 'published',
      },
    })
    const env = { ...process.env }
    delete env.RECRUITMENT_CONTENT_HOSTING_ENABLED
    const child = spawnSync(
      process.execPath,
      ['-r', '@swc-node/register', 'scripts/lib/recruitment-hosting-default-probe.ts', jobId],
      { cwd: process.cwd(), env, encoding: 'utf8' },
    )
    const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`
    if (child.status !== 0 || !output.includes('PROBE_OK')) {
      fail(`2. 干净子进程未证明列表为空且详情/写入 403：${output.slice(-800)}`)
    }
    pass('2. 干净子进程：列表为空，详情与写入 403')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
