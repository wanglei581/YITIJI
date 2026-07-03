import 'dotenv/config'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { runGateAfter, runGateBefore, type DeployGateBaseline } from './deploy-data-safety-gate'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function assertVerifyDatabaseSafe(): void {
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  const nodeEnv = process.env['NODE_ENV'] ?? ''
  if (nodeEnv === 'production') {
    fail('DP_GATE_VERIFY_UNSAFE_DATABASE: refuse to run row-writing verify with NODE_ENV=production')
  }
  if (!databaseUrl) {
    fail('DP_GATE_VERIFY_UNSAFE_DATABASE: DATABASE_URL is required')
  }
  const isLocalSqlite = databaseUrl.startsWith('file:')
  const isLocalPostgres = /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(databaseUrl)
  if (!isLocalSqlite && !isLocalPostgres) {
    fail('DP_GATE_VERIFY_UNSAFE_DATABASE: verify may only write to local SQLite or localhost PostgreSQL')
  }
}

async function expectRejects(fn: () => Promise<unknown>, expectedCode: string, label: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedCode)) {
      fail(`${label}: expected ${expectedCode}, got ${message}`)
    }
    pass(label)
    return
  }
  fail(`${label}: expected rejection ${expectedCode}`)
}

async function main(): Promise<void> {
  console.log('\n=== DP-GATE 部署不丢数据门禁验证 ===')
  assertVerifyDatabaseSafe()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const tempDir = mkdtempSync(join(tmpdir(), 'dp-gate-'))
  const batch = `deploy-vfy-${randomBytes(6).toString('hex')}`
  const endUserId = `dp_gate_user_${randomBytes(6).toString('hex')}`
  const baselinePath = join(tempDir, 'baseline.json')
  let baseline: DeployGateBaseline | undefined

  try {
    await prisma.auditLog.deleteMany({
      where: { action: 'deploy.canary', targetType: 'deploy_canary', targetId: batch },
    })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `dp_gate_phone_hash_${endUserId}`,
        phoneEnc: 'dp-gate-local-encrypted-phone-placeholder',
        nickname: 'DP-GATE 本地验证锚点',
      },
    })

    baseline = await runGateBefore({ prisma, batch, outPath: baselinePath })

    if (baseline.canary.table !== 'AuditLog') fail('before must use AuditLog canary')
    if (baseline.canary.targetId !== batch) fail('before must persist targetId=batch')
    if (!baseline.canary.id || !baseline.canary.createdAt) fail('before must return canary id and createdAt')
    if (baseline.anchors.EndUser.latestByCreatedAt?.id !== endUserId) {
      fail('before must record latest EndUser baseline anchor')
    }
    if (!baseline.counts.FileObject || typeof baseline.counts.FileObject.before !== 'number') {
      fail('before must include FileObject count')
    }
    if (!baseline.maxCreatedAt.FileObject || !('before' in baseline.maxCreatedAt.FileObject)) {
      fail('before must include FileObject max(createdAt)')
    }
    pass('before 写入 AuditLog canary，并输出核心表 count / max(createdAt) 基线')

    const after = await runGateAfter({ prisma, baselinePath })
    if (after.status !== 'passed') fail(`after expected passed, got ${after.status}`)
    if (after.canaryFound !== true) fail('after must confirm canary exists')
    pass('after 只读确认 canary 仍存在，且核心表未回退')

    const countDropBaselinePath = join(tempDir, 'baseline-count-drop.json')
    const countDropBaseline: DeployGateBaseline = {
      ...baseline,
      counts: {
        ...baseline.counts,
        FileObject: { before: baseline.counts.FileObject.before + 1 },
      },
    }
    writeFileSync(countDropBaselinePath, `${JSON.stringify(countDropBaseline, null, 2)}\n`, 'utf8')
    await expectRejects(
      () => runGateAfter({ prisma, baselinePath: countDropBaselinePath }),
      'DP_GATE_COUNT_DROPPED',
      '核心表 count 下降且无解释时硬失败',
    )
    const countDropAllowed = await runGateAfter({
      prisma,
      baselinePath: countDropBaselinePath,
      allowCountDrops: { FileObject: 'verified cleanup job removed expired temporary files' },
    })
    if (countDropAllowed.warnings.length !== 1) fail('count drop with explanation must produce one warning')
    pass('核心表 count 下降有明确 cleanup 解释时降级为 warning')

    const rollbackBaselinePath = join(tempDir, 'baseline-rollback.json')
    const rollbackBaseline: DeployGateBaseline = {
      ...baseline,
      maxCreatedAt: {
        ...baseline.maxCreatedAt,
        FileObject: { before: '2999-01-01T00:00:00.000Z' },
      },
    }
    writeFileSync(rollbackBaselinePath, `${JSON.stringify(rollbackBaseline, null, 2)}\n`, 'utf8')
    await expectRejects(
      () => runGateAfter({ prisma, baselinePath: rollbackBaselinePath }),
      'DP_GATE_MAX_CREATED_AT_ROLLED_BACK',
      'max(createdAt) 回退时硬失败',
    )

    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    await expectRejects(
      () =>
        runGateAfter({
          prisma,
          baselinePath,
          allowCountDrops: { EndUser: 'verified local test deletes the baseline anchor' },
        }),
      'DP_GATE_ANCHOR_MISSING',
      '基线锚点记录消失时硬失败，即使 count 下降有解释',
    )

    await prisma.auditLog.deleteMany({ where: { id: baseline.canary.id } })
    await expectRejects(
      () => runGateAfter({ prisma, baselinePath }),
      'DP_GATE_CANARY_MISSING',
      'canary 丢失时 after 硬失败',
    )
  } finally {
    try {
      if (baseline?.canary.id) {
        await prisma.auditLog.deleteMany({ where: { id: baseline.canary.id } })
      }
    } catch (error) {
      console.warn(`WARN cleanup canary failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      await prisma.endUser.deleteMany({ where: { id: endUserId } })
    } catch (error) {
      console.warn(`WARN cleanup endUser failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch (error) {
      console.warn(`WARN cleanup temp dir failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
