/**
 * 本地演示包（P1-23）种子：把 scripts/demo/demo-data.json 写进 .demo/demo.db。
 *
 * 由 `pnpm demo` 在 services/api 目录下以
 *   node -r @swc-node/register ../../scripts/demo/seed-demo.ts
 * 调起；不要手工对别的库运行。
 *
 * 写库前的三道闸（顺序固定，门禁 verify-demo-kit 按文本顺序检查）：
 *   1. assertDemoSeedAllowed：沿用 services/api/prisma/seed-guard.ts 的确认机制
 *      （NODE_ENV=development + DEMO_SEED_CONFIRM）。
 *   2. assertDemoDatabase：DATABASE_URL 必须指向 <仓库>/.demo/demo.db，绝不是开发库。
 *   3. assertDemoMarkers：每一条对外可见的名称都带「演示」、终端编号以 DEMO- 开头。
 *
 * 不写入任何岗位、招聘会、企业资料，不写心跳（设备状态保持真实的「未连接」），
 * 不写打印任务。
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { basename, dirname, join, resolve } from 'path'
import { assertDemoSeedAllowed } from '../../services/api/prisma/seed-guard'
import { createPrismaClient } from '../../services/api/src/prisma/create-client'
import { PASSWORD_PROOF_STATE, passwordProofState } from '../../services/api/src/auth/password-proof-state'
import { DEV_DEFAULT_PRICE_CONFIG } from '../../services/api/src/payment/price-config.seed'

interface DemoData {
  organizations: Array<{ id: string; name: string; type: string; contact: string }>
  users: Array<{ username: string; name: string; role: 'admin' | 'partner'; orgId: string | null; passwordEnv: string }>
  terminals: Array<{ terminalCode: string; displayName: string; locationLabel: string; orgId: string }>
  policies: Array<{
    id: string; sourceOrgId: string; sourceName: string; kind: string; category: string; audience: string
    externalId: string; title: string; summary: string; content: string
  }>
  legalDocs: Array<{ docType: string; version: string; title: string; content: string }>
  priceDescriptionPrefix: string
}

const DEMO_MARK = '演示'

function assertDemoDatabase(): string {
  const url = process.env['DATABASE_URL'] ?? ''
  const repoRoot = resolve(process.env['DEMO_REPO_ROOT'] ?? join(__dirname, '..', '..'))
  if (!url.startsWith('file:')) throw new Error('DEMO_DB_NOT_SQLITE: 演示库只允许本机 SQLite 文件')
  const file = resolve(url.slice('file:'.length))
  const devDb = resolve(repoRoot, 'services', 'api', 'prisma', 'dev.db')
  if (file === devDb || basename(file) === 'dev.db') {
    throw new Error('DEMO_DB_IS_DEV_DB: 拒绝向开发库写入演示数据')
  }
  if (file !== resolve(repoRoot, '.demo', 'demo.db') || basename(dirname(file)) !== '.demo') {
    throw new Error(`DEMO_DB_OUTSIDE_DEMO_DIR: 演示库必须是 <仓库>/.demo/demo.db，当前 ${file}`)
  }
  return url
}

function assertDemoMarkers(data: DemoData): void {
  const visible: Array<[string, string]> = []
  for (const o of data.organizations) visible.push([`organizations.${o.id}.name`, o.name])
  for (const u of data.users) visible.push([`users.${u.username}.name`, u.name])
  for (const t of data.terminals) {
    if (!t.terminalCode.startsWith('DEMO-')) throw new Error(`DEMO_MARKER_MISSING: 终端编号必须以 DEMO- 开头：${t.terminalCode}`)
    visible.push([`terminals.${t.terminalCode}.displayName`, t.displayName], [`terminals.${t.terminalCode}.locationLabel`, t.locationLabel])
  }
  for (const p of data.policies) {
    visible.push([`policies.${p.id}.title`, p.title], [`policies.${p.id}.sourceName`, p.sourceName],
      [`policies.${p.id}.summary`, p.summary], [`policies.${p.id}.content`, p.content])
  }
  for (const d of data.legalDocs) visible.push([`legalDocs.${d.docType}.title`, d.title], [`legalDocs.${d.docType}.content`, d.content])
  visible.push(['priceDescriptionPrefix', data.priceDescriptionPrefix])
  const missing = visible.filter(([, value]) => !value.includes(DEMO_MARK))
  if (missing.length > 0) {
    throw new Error(`DEMO_MARKER_MISSING: 以下演示数据缺少「演示」标记：${missing.map(([k]) => k).join(', ')}`)
  }
}

assertDemoSeedAllowed({ NODE_ENV: process.env['NODE_ENV'], DEMO_SEED_CONFIRM: process.env['DEMO_SEED_CONFIRM'] })
const databaseUrl = assertDemoDatabase()
const data = JSON.parse(readFileSync(join(__dirname, 'demo-data.json'), 'utf8')) as DemoData
assertDemoMarkers(data)

// bcryptjs 装在 services/api 下；本文件位于 scripts/demo，按 api 包解析依赖。
const apiRequire = createRequire(resolve(__dirname, '..', '..', 'services', 'api', 'package.json'))
const bcrypt = apiRequire('bcryptjs') as { hash(value: string, rounds: number): Promise<string> }

const prisma = createPrismaClient(databaseUrl).client

async function main(): Promise<void> {
  for (const org of data.organizations) {
    const fields = {
      name: org.name,
      type: org.type,
      contact: org.contact,
      enabled: true,
      contentTrustStatus: 'active',
      contentTrustReviewedBy: 'demo-seed',
      contentTrustReviewedAt: new Date(),
      contentTrustReason: '本地演示数据',
    }
    await prisma.organization.upsert({ where: { id: org.id }, update: fields, create: { id: org.id, ...fields } })
  }

  let adminId: string | null = null
  for (const user of data.users) {
    const password = process.env[user.passwordEnv]
    if (!password || password.length < 10) throw new Error(`DEMO_PASSWORD_MISSING: ${user.passwordEnv}`)
    const fields = {
      passwordHash: await bcrypt.hash(password, 10),
      passwordProofState: passwordProofState(PASSWORD_PROOF_STATE.TEMPORARY),
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      enabled: true,
      deletedAt: null,
    }
    const row = await prisma.user.upsert({
      where: { username: user.username },
      update: fields,
      create: { username: user.username, ...fields },
      select: { id: true },
    })
    if (user.role === 'admin') adminId = row.id
  }

  for (const terminal of data.terminals) {
    // agentToken 先放一个随机占位值；`pnpm demo` 启动服务端后走 /auth/terminal/register
    // 重新签发真实凭证（与终端程序首次注册同一条路），占位值随即失效。
    const placeholder = `demo-placeholder-${terminal.terminalCode}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const fields = {
      displayName: terminal.displayName,
      locationLabel: terminal.locationLabel,
      orgId: terminal.orgId,
      enabled: true,
      lifecycleStatus: 'active',
    }
    await prisma.terminal.upsert({
      where: { terminalCode: terminal.terminalCode },
      update: fields,
      create: {
        id: `t_demo_${terminal.terminalCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        terminalCode: terminal.terminalCode,
        agentToken: placeholder,
        credentialGeneration: 0,
        deviceFingerprint: `demo-fingerprint-${terminal.terminalCode}`,
        ...fields,
      },
    })
  }

  const now = new Date()
  for (const policy of data.policies) {
    const fields = {
      sourceOrgId: policy.sourceOrgId,
      sourceName: policy.sourceName,
      kind: policy.kind,
      category: policy.category,
      audience: policy.audience,
      externalId: policy.externalId,
      title: policy.title,
      summary: policy.summary,
      content: policy.content,
      externalUrl: null,
      publishedDate: now,
      reviewStatus: 'approved',
      publishStatus: 'published',
      reviewedBy: adminId,
      reviewedAt: now,
      contentVersion: 1,
      publishConfirmedBy: 'demo-seed',
      publishConfirmedAt: now,
      publishConfirmedContentVersion: 1,
    }
    await prisma.policyPost.upsert({ where: { id: policy.id }, update: fields, create: { id: policy.id, ...fields } })
  }

  for (const doc of data.legalDocs) {
    await prisma.legalDocVersion.updateMany({ where: { docType: doc.docType, isActive: true }, data: { isActive: false } })
    const id = `demo-legal-${doc.docType}`
    const fields = {
      docType: doc.docType,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      isActive: true,
      publishedAt: now,
      publishedBy: adminId,
    }
    await prisma.legalDocVersion.upsert({ where: { id }, update: fields, create: { id, ...fields } })
  }

  for (const price of DEV_DEFAULT_PRICE_CONFIG) {
    const fields = {
      unitCents: price.unitCents,
      unit: price.unit,
      active: true,
      description: `${data.priceDescriptionPrefix}${price.description}`,
    }
    await prisma.priceConfig.upsert({ where: { serviceKey: price.serviceKey }, update: fields, create: { serviceKey: price.serviceKey, ...fields } })
  }

  console.log(
    `[demo-seed] 已写入演示数据：机构 ${data.organizations.length}、账号 ${data.users.length}、` +
    `终端 ${data.terminals.length}、政策 ${data.policies.length}、法务文档 ${data.legalDocs.length}、价目 ${DEV_DEFAULT_PRICE_CONFIG.length}`,
  )
}

main()
  .catch((error: unknown) => {
    console.error('[demo-seed] 失败：', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
