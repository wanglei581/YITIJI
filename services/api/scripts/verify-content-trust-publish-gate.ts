// verify-content-trust-publish-gate.ts
//
// 发布闸门门禁：**来源机构未被显式标记为内容可信,其内容不得被发布**。
//
// 事故背景(为什么有这道门禁):
//   `Organization.contentTrustStatus` 早在 P1 expand 就建好了,schema 注释写
//   「Wave 2 回填后再切门禁」—— 但那句「再切门禁」从没在发布路径发生。
//   `contentTrustStatus !== 'active'` 的 fail-closed 只存在于管理端**只读**治理
//   视图(RecruitmentContentReadService),发布路径对它零引用。结果是治理清单
//   裁定「未授权不进入生产」的机构,其岗位仍被推上了生产公网。
//   更糟:下架后状态是 unpublished,而批量发布候选池恰好收 draft+unpublished,
//   只下架不装闸门,下一次点批量发布就原样复发。
//
// 必须同时证明的四件事(缺一不可):
//   ① 非 active 机构的内容**单条发布**被拒(岗位/招聘会/政策/企业/招聘会资料/线下机构)
//   ② 非 active 机构的内容**批量发布**被拒,且在**预览阶段**就进 excluded 统计
//   ③ contentTrustStatus='active' 但 archivedAt 非空的机构**同样被拒**
//   ④ **active 且未归档的机构可以正常发布** —— 只验拒绝等于可能把发布焊死了
//
// 另外还证明:
//   ⑤ unpublish(下架)不受闸门限制 —— 否则不可信内容将无法被撤下,事故无法处置
//   ⑥ 源码层没有第二条「绕过闸门」的发布路径(publish 命名方法必须在清单内)
//
// 纯内存假 Prisma + 真实 service,不连数据库、不起 HTTP,两个 CI job 都能直接跑。
//
// Run: node -r @swc-node/register scripts/verify-content-trust-publish-gate.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

process.env['FILE_SIGNING_SECRET'] ||= 'verify-content-trust-gate-file-signing-secret-32b'

import {
  CONTENT_TRUST_DENIED_CODE,
  contentTrustDenial,
  contentTrustDenialMessage,
  isContentTrustActive,
} from '../src/common/content-trust'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { PoliciesService } from '../src/policies/policies.service'
import { CompaniesService } from '../src/companies/companies.service'
import { FairMaterialService } from '../src/jobs/fair-material.service'
import { OfflineAgenciesService } from '../src/offline-agencies/offline-agencies.service'
import { BulkPublishService } from '../src/bulk-publish/bulk-publish.service'
import { AdminOrgContentTrustService } from '../src/orgs/admin-org-content-trust.service'
import type { JobsService } from '../src/jobs/jobs.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { AuditService } from '../src/audit/audit.service'
import type { StorageService } from '../src/storage/storage.service'
import type { FairMaterialPrintBridgeService } from '../src/jobs/fair-material-print-bridge.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

// ── harness ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

/** 捕获 Nest 异常里的 { error: { code, message } }。 */
function errorOf(e: unknown): { code: string; message: string } {
  const resp = (e as { getResponse?: () => unknown })?.getResponse?.()
  const nested = (resp as { error?: { code?: unknown; message?: unknown } })?.error
  if (nested && typeof nested.code === 'string') {
    return { code: nested.code, message: typeof nested.message === 'string' ? nested.message : '' }
  }
  return { code: '(非结构化异常)', message: (e as Error)?.message ?? String(e) }
}

/** 断言某次调用被闸门拒绝(错误码必须正是闸门那一条,不接受「随便报个错」)。 */
async function assertDeniedByGate(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
    assert(label, false, '调用竟然成功了 —— 闸门没拦住')
  } catch (e) {
    const { code, message } = errorOf(e)
    assert(label, code === CONTENT_TRUST_DENIED_CODE, `实际错误码 ${code}(${message})`)
  }
}

async function assertAllowed(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
    assert(label, true)
  } catch (e) {
    const { code, message } = errorOf(e)
    assert(label, false, `本应放行却被拒:${code} ${message}`)
  }
}

// ── 内存假 Prisma ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      const clauses = (Array.isArray(cond) ? cond : [cond]) as Record<string, unknown>[]
      if (!clauses.every((c) => matches(row, c))) return false
      continue
    }
    // OR 必须显式支持:批量发布的候选池带了有效期条件(jobValidityWhere 是 OR 写法)。
    // 少了这一支,未知键会走到下面的标量分支、恒真放行 —— 假 Prisma 会变得比真库宽松,
    // 断言就静默退化成「什么都能过」。
    if (key === 'OR') {
      const clauses = (Array.isArray(cond) ? cond : [cond]) as Record<string, unknown>[]
      if (!clauses.some((c) => matches(row, c))) return false
      continue
    }
    const val = row[key]
    if (cond !== null && typeof cond === 'object') {
      const c = cond as Record<string, unknown>
      if ('in' in c && !(c.in as unknown[]).includes(val)) return false
      if ('notIn' in c && (c.notIn as unknown[]).includes(val)) return false
      if ('not' in c && val === c.not) return false
      if ('gte' in c && !(val instanceof Date && val >= (c.gte as Date))) return false
      if ('lte' in c && !(val instanceof Date && val <= (c.lte as Date))) return false
      // SQL 语义:NULL 参与比较结果为 UNKNOWN,即不命中。
      if ('lt' in c && !(val instanceof Date && val < (c.lt as Date))) return false
    } else if (cond === null) {
      // Prisma 的 `field: null` = IS NULL;假行用 undefined 表示同一件事。
      if (val !== null && val !== undefined) return false
    } else if (val !== cond) {
      return false
    }
  }
  return true
}

function makeTable(seed: Row[]) {
  const rows = seed.map((r) => ({ ...r }))
  return {
    rows,
    findMany: async (args: Record<string, unknown> = {}) => {
      let out = rows.filter((r) => matches(r, args.where as Record<string, unknown>))
      const orderBy = args.orderBy as { syncTime?: string; id?: string }[] | undefined
      if (orderBy) {
        out = [...out].sort((a, b) => {
          for (const o of orderBy) {
            if (o.syncTime) {
              const d = (a.syncTime as Date).getTime() - (b.syncTime as Date).getTime()
              if (d !== 0) return o.syncTime === 'asc' ? d : -d
            }
            if (o.id) {
              const d = String(a.id).localeCompare(String(b.id))
              if (d !== 0) return o.id === 'asc' ? d : -d
            }
          }
          return 0
        })
      }
      if (typeof args.take === 'number') out = out.slice(0, args.take)
      return out.map((r) => ({ ...r }))
    },
    count: async (args: Record<string, unknown> = {}) =>
      rows.filter((r) => matches(r, args.where as Record<string, unknown>)).length,
    findUnique: async (args: { where: { id: string } }) => {
      const hit = rows.find((r) => r.id === args.where.id)
      return hit ? { ...hit } : null
    },
    findFirst: async (args: { where: Record<string, unknown> }) => {
      const hit = rows.find((r) => matches(r, args.where))
      return hit ? { ...hit } : null
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const hit = rows.find((r) => r.id === args.where.id)
      if (!hit) throw new Error(`row not found: ${args.where.id}`)
      Object.assign(hit, args.data)
      return { ...hit }
    },
  }
}

const auditWrites: { action: string; targetType: string; targetId: unknown }[] = []
const fakeAudit = {
  write: async (a: { action: string; targetType: string; targetId?: string | null }) => {
    auditWrites.push({ action: a.action, targetType: a.targetType, targetId: a.targetId })
    return 'audit-id'
  },
} as unknown as AuditService

const user: AuthedUser = { userId: 'admin-1', role: 'admin' } as AuthedUser

// ── 机构：四种信任形态 ────────────────────────────────────────────────────────

const NOW = new Date('2026-08-17T00:00:00Z')

/** 唯一允许发布的形态 */
const ORG_TRUSTED = 'org-trusted'
/** 事故形态:字段从未被回填(nullable,null) —— 正是腾讯样本机构的状态 */
const ORG_NULL = 'org-null-never-marked'
/** 已暂停 */
const ORG_SUSPENDED = 'org-suspended'
/** contentTrustStatus=active 但已归档 —— 单看 status 会误放行 */
const ORG_ARCHIVED = 'org-active-but-archived'
/** 内容行引用了一个不存在的机构 id */
const ORG_MISSING = 'org-does-not-exist'

function orgRows(): Row[] {
  return [
    { id: ORG_TRUSTED, name: '已核验来源机构', type: 'public_employment_service', contentTrustStatus: 'active', archivedAt: null },
    { id: ORG_NULL, name: '腾讯招聘公开来源样本（预生产验证）', type: 'hr_company', contentTrustStatus: null, archivedAt: null },
    { id: ORG_SUSPENDED, name: '已暂停机构', type: 'hr_company', contentTrustStatus: 'suspended', archivedAt: null },
    { id: ORG_ARCHIVED, name: '已归档机构', type: 'hr_company', contentTrustStatus: 'active', archivedAt: NOW },
  ]
}

function contentRow(id: string, sourceOrgId: string, extra: Row = {}): Row {
  return {
    id,
    title: `内容 ${id}`,
    name: `内容 ${id}`,
    company: '示例公司',
    city: '青岛',
    salary: null,
    tagsJson: null,
    description: null,
    requirements: null,
    sourceId: null,
    sourceOrgId,
    externalId: `ext-${id}`,
    sourceName: '来源数据源',
    sourceUrl: 'https://example.org',
    kind: 'notice',
    reviewStatus: 'approved',
    publishStatus: 'draft',
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    province: null,
    district: null,
    industry: null,
    companyType: null,
    fairParticipant: false,
    syncTime: new Date('2026-08-01T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    // JobFair 专有:mapper 会无条件 toISOString(),缺了会在**放行**路径炸掉
    startAt: new Date('2026-09-01T01:00:00Z'),
    endAt: new Date('2026-09-01T09:00:00Z'),
    venue: '示例会场',
    ...extra,
  }
}

/** 每种信任形态各一条 approved+draft 内容,id 前缀区分内容类型。 */
function contentSet(prefix: string): Row[] {
  return [
    contentRow(`${prefix}-trusted`, ORG_TRUSTED),
    contentRow(`${prefix}-null`, ORG_NULL),
    contentRow(`${prefix}-suspended`, ORG_SUSPENDED),
    contentRow(`${prefix}-archived`, ORG_ARCHIVED),
    contentRow(`${prefix}-missingorg`, ORG_MISSING),
  ]
}

function buildFixture() {
  auditWrites.length = 0
  const organization = makeTable(orgRows())
  const job = makeTable(contentSet('job'))
  const jobFair = makeTable(contentSet('fair'))
  const policyPost = makeTable(contentSet('policy'))
  const companyProfile = makeTable(contentSet('company'))
  const offlineAgency = makeTable([
    // 有来源机构(外部供稿)→ 受闸门约束
    contentRow('agency-null', ORG_NULL, { reviewStatus: 'approved' }),
    contentRow('agency-trusted', ORG_TRUSTED, { reviewStatus: 'approved' }),
    // 无来源机构(Admin 自录目录)→ 不套闸门,必须仍可发布
    contentRow('agency-selfauthored', null as unknown as string, { sourceOrgId: null, reviewStatus: 'approved' }),
  ])
  const fairMaterial = makeTable([
    { id: 'mat-trusted', jobFairId: 'fair-trusted', name: '资料A', type: 'pdf', storageKey: 'k/a', publishStatus: 'draft', deletedAt: null, allowPrint: true, pageCount: 1, description: null, mimeType: 'application/pdf', sizeBytes: 1, createdAt: NOW, updatedAt: NOW },
    { id: 'mat-null', jobFairId: 'fair-null', name: '资料B', type: 'pdf', storageKey: 'k/b', publishStatus: 'draft', deletedAt: null, allowPrint: true, pageCount: 1, description: null, mimeType: 'application/pdf', sizeBytes: 1, createdAt: NOW, updatedAt: NOW },
  ])

  const prisma = { organization, job, jobFair, policyPost, companyProfile, offlineAgency, fairMaterial } as unknown as PrismaService

  const jobsAdmin = new JobsAdminService(prisma, fakeAudit)
  const policies = new PoliciesService(prisma, fakeAudit)
  const companies = new CompaniesService(prisma, fakeAudit)
  const agencies = new OfflineAgenciesService(prisma)
  const noopBridge = {
    revokeForMaterial: async () => undefined,
    revokeForFair: async () => undefined,
  } as unknown as FairMaterialPrintBridgeService
  const materials = new FairMaterialService(prisma, fakeAudit, {} as unknown as StorageService, noopBridge)

  // 门面只是转发,与运行时 JobsService 的委托完全一致
  const jobsFacade = {
    publishJobSource: (id: string, action: 'publish' | 'unpublish', u: AuthedUser) => jobsAdmin.publishJobSource(id, action, u),
    publishFairSource: (id: string, action: 'publish' | 'unpublish', u: AuthedUser) => jobsAdmin.publishFairSource(id, action, u),
  } as unknown as JobsService

  const bulk = new BulkPublishService(prisma, jobsFacade, policies)
  return { prisma, jobsAdmin, policies, companies, agencies, materials, bulk, job, jobFair, policyPost, companyProfile, offlineAgency, fairMaterial }
}

// ── ⑥ 源码层清单:不允许出现「没做过闸门决策」的新发布路径 ────────────────────

const SRC_ROOT = join(__dirname, '..', 'src')

/**
 * 全仓 publish 命名方法清单。新增任何 publish 方法都会让本门禁转红,
 * 直到作者在这里显式登记「装了闸门」还是「豁免及理由」。
 *
 * gated=true 的条目,其所在文件必须真的出现 assertOrgContentTrustActive。
 */
const PUBLISH_PATH_INVENTORY: { file: string; method: string; gated: boolean; note: string }[] = [
  { file: 'jobs/jobs-admin.service.ts', method: 'publishJobSource', gated: true, note: 'Job → 来源机构 sourceOrgId' },
  { file: 'jobs/jobs-admin.service.ts', method: 'publishFairSource', gated: true, note: 'JobFair → 来源机构 sourceOrgId' },
  { file: 'policies/policies.service.ts', method: 'publishPolicy', gated: true, note: 'PolicyPost → 来源机构 sourceOrgId' },
  { file: 'companies/companies.service.ts', method: 'adminPublish', gated: true, note: 'CompanyProfile → 来源机构 sourceOrgId' },
  { file: 'jobs/fair-material.service.ts', method: 'publishMaterial', gated: true, note: 'FairMaterial → 所属招聘会的来源机构' },
  { file: 'offline-agencies/offline-agencies.service.ts', method: 'adminPublish', gated: true, note: 'OfflineAgency:sourceOrgId 非空时受闸门约束' },
  {
    file: 'jobs/admin-fairs.service.ts', method: 'publishMaterial', gated: false,
    note: '门面,原样转发 FairMaterialService.publishMaterial,闸门在被转发方',
  },
  {
    file: 'benefit-activities/benefit-activities.service.ts', method: 'publish', gated: false,
    note: 'BenefitActivity 是平台自营权益活动,模型无 organization 关联,不存在「来源机构信任」这个决策对象',
  },
  {
    file: 'terminals/toolbox-governance.service.ts', method: 'publishVersion', gated: false,
    note: '一体机工具箱应用版本发布,不是对外内容,无来源机构',
  },
  {
    file: 'auth/auth.service.ts', method: 'publishCredentialChangeSessionState', gated: false,
    note: '这里的 publish 是 pub/sub 广播会话状态,与内容发布无关',
  },
  {
    file: 'auth/partner-phone-rebind.service.ts', method: 'publishSessionState', gated: false,
    note: '同上,pub/sub 广播',
  },
  {
    file: 'orgs/admin-orgs.service.ts', method: 'publishDeletedSessionState', gated: false,
    note: '同上,pub/sub 广播',
  },
  {
    file: 'bulk-publish/bulk-publish.service.ts', method: 'previewBulkPublish', gated: false,
    note: '只读预览;闸门以 excluded.orgTrustInactive 体现,判据同源',
  },
  {
    file: 'bulk-publish/bulk-publish.service.ts', method: 'executeBulkPublish', gated: false,
    note: '逐条复用单条发布方法,闸门在被复用方,本文件不写 publishStatus',
  },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 抽取文件里所有 async 方法名(顶层缩进的类方法即可,足够覆盖 service 写法)。 */
function asyncMethodNames(code: string): string[] {
  const names: string[] = []
  const re = /^\s*(?:private\s+|public\s+|protected\s+|static\s+)*async\s+([A-Za-z_$][\w$]*)\s*\(/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) names.push(m[1]!)
  return names
}

/** 只读语义的 publish 相关命名(getPublishedJobs / resolvePublishedTitle …)不算发布路径。 */
function isReadOnlyPublishName(name: string): boolean {
  return /^(get|list|build|resolve|load|find|count|map)/.test(name)
}

function isUnpublishName(name: string): boolean {
  return /unpublish/i.test(name)
}

function checkSourceInventory(): void {
  const files = walk(SRC_ROOT).filter((f) => !/\.(controller|dto|types|spec)\.ts$/.test(f))
  const found: { file: string; method: string }[] = []
  const gateFiles = new Set<string>()

  for (const full of files) {
    const code = readFileSync(full, 'utf8')
    const rel = relative(SRC_ROOT, full).split('\\').join('/')
    if (code.includes('assertOrgContentTrustActive')) gateFiles.add(rel)
    for (const name of asyncMethodNames(code)) {
      if (!/publish/i.test(name)) continue
      if (isUnpublishName(name) || isReadOnlyPublishName(name)) continue
      found.push({ file: rel, method: name })
    }
  }

  const key = (x: { file: string; method: string }) => `${x.file}#${x.method}`
  const inventoryKeys = new Set(PUBLISH_PATH_INVENTORY.map(key))
  const foundKeys = new Set(found.map(key))

  const undeclared = [...foundKeys].filter((k) => !inventoryKeys.has(k))
  assert(
    '源码里没有「未登记」的 publish 方法(新增发布路径必须显式做闸门决策)',
    undeclared.length === 0,
    `未登记: ${undeclared.join(', ')}`,
  )

  const vanished = [...inventoryKeys].filter((k) => !foundKeys.has(k))
  assert('清单里没有已经消失的条目(清单不腐烂)', vanished.length === 0, `已消失: ${vanished.join(', ')}`)

  for (const entry of PUBLISH_PATH_INVENTORY.filter((e) => e.gated)) {
    assert(
      `${entry.file} 确实调用了发布闸门 assertOrgContentTrustActive`,
      gateFiles.has(entry.file),
      '文件里找不到闸门调用 —— 闸门被删了或从未装上',
    )
  }

  // controller 只做转发:带 publish 路由的 controller 不得自己写库
  // (否则它就是一条绕过 service 层闸门的发布路径)。
  const controllers = walk(SRC_ROOT).filter((f) => f.endsWith('.controller.ts'))
  const writingControllers: string[] = []
  for (const full of controllers) {
    const code = readFileSync(full, 'utf8')
    if (!/@(Patch|Post|Put)\([^)]*publish/i.test(code)) continue
    if (/prisma\.\w+\.(update|updateMany|create|createMany|upsert)\s*\(/.test(code)) {
      writingControllers.push(relative(SRC_ROOT, full).split('\\').join('/'))
    }
  }
  assert(
    '带 publish 路由的 controller 全部是纯转发(自己不写库)',
    writingControllers.length === 0,
    `自行写库的 controller: ${writingControllers.join(', ')}`,
  )
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== 发布闸门:来源机构内容信任 fail-closed ===')

  // ── ⓪ 纯判定穷举 ──────────────────────────────────────────────────────────
  console.log('\n[0] 判定函数:只有 active + 未归档放行')
  {
    assert('active + 未归档 → 放行', isContentTrustActive({ id: 'o', name: 'n', contentTrustStatus: 'active', archivedAt: null }))
    assert('null(从未标记)→ 拒绝', contentTrustDenial({ id: 'o', name: 'n', contentTrustStatus: null, archivedAt: null }) === 'trust_not_active')
    assert('pending → 拒绝', contentTrustDenial({ id: 'o', name: 'n', contentTrustStatus: 'pending', archivedAt: null }) === 'trust_not_active')
    assert('suspended → 拒绝', contentTrustDenial({ id: 'o', name: 'n', contentTrustStatus: 'suspended', archivedAt: null }) === 'trust_not_active')
    assert('revoked → 拒绝', contentTrustDenial({ id: 'o', name: 'n', contentTrustStatus: 'revoked', archivedAt: null }) === 'trust_not_active')
    assert('active 但已归档 → 拒绝', contentTrustDenial({ id: 'o', name: 'n', contentTrustStatus: 'active', archivedAt: NOW }) === 'archived')
    assert('机构不存在 → 拒绝', contentTrustDenial(null) === 'org_missing')

    const msg = contentTrustDenialMessage(ORG_NULL, { id: ORG_NULL, name: '某机构', contentTrustStatus: null, archivedAt: null }, 'trust_not_active')
    assert('拒绝文案含机构名', msg.includes('某机构'))
    assert('拒绝文案含机构 id', msg.includes(ORG_NULL))
    assert('拒绝文案含当前状态', msg.includes('未标记'))
    assert('拒绝文案给出下一步(标记入口)', msg.includes('content-trust'))
  }

  // ── ① 单条发布:非 active 一律被拒 ────────────────────────────────────────
  console.log('\n[1] 单条发布:非 active 机构的内容一律被拒')
  {
    const f = buildFixture()
    await assertDeniedByGate('岗位 · 机构 contentTrustStatus=null(事故形态)', () => f.jobsAdmin.publishJobSource('job-null', 'publish', user))
    await assertDeniedByGate('岗位 · 机构 suspended', () => f.jobsAdmin.publishJobSource('job-suspended', 'publish', user))
    await assertDeniedByGate('岗位 · 机构行不存在', () => f.jobsAdmin.publishJobSource('job-missingorg', 'publish', user))
    await assertDeniedByGate('招聘会 · 机构 null', () => f.jobsAdmin.publishFairSource('fair-null', 'publish', user))
    await assertDeniedByGate('政策 · 机构 null', () => f.policies.publishPolicy('policy-null', 'publish', user))
    await assertDeniedByGate('企业资料 · 机构 null', () => f.companies.adminPublish('company-null', { publish: true }, user))
    await assertDeniedByGate('招聘会资料 · 所属招聘会的机构 null', () => f.materials.publishMaterial('fair-null', 'mat-null', 'publish', user))
    await assertDeniedByGate('线下机构 · sourceOrgId 指向 null 机构', () => f.agencies.adminPublish('agency-null', 'published'))

    const stillDraft = ['job-null', 'job-suspended', 'job-missingorg'].every(
      (id) => f.job.rows.find((r) => r.id === id)?.publishStatus === 'draft',
    )
    assert('被拒的条目状态没有被改动(仍是 draft)', stillDraft)
    assert('被拒的发布没有写审计(动作没发生就不该留发布痕迹)', auditWrites.filter((a) => /publish/.test(a.action)).length === 0)
  }

  // ── ③ archivedAt 非空的 active 机构同样被拒 ──────────────────────────────
  console.log('\n[2] archivedAt 非空:即使 contentTrustStatus=active 也被拒')
  {
    const f = buildFixture()
    await assertDeniedByGate('岗位 · 机构 active 但已归档', () => f.jobsAdmin.publishJobSource('job-archived', 'publish', user))
    await assertDeniedByGate('招聘会 · 机构 active 但已归档', () => f.jobsAdmin.publishFairSource('fair-archived', 'publish', user))
    await assertDeniedByGate('政策 · 机构 active 但已归档', () => f.policies.publishPolicy('policy-archived', 'publish', user))
    await assertDeniedByGate('企业资料 · 机构 active 但已归档', () => f.companies.adminPublish('company-archived', { publish: true }, user))
  }

  // ── ④ 放行仍然工作(最重要的反向证明:没把发布焊死)────────────────────────
  console.log('\n[3] active + 未归档:发布必须仍然正常工作')
  {
    const f = buildFixture()
    await assertAllowed('岗位 · 可信机构可以发布', () => f.jobsAdmin.publishJobSource('job-trusted', 'publish', user))
    await assertAllowed('招聘会 · 可信机构可以发布', () => f.jobsAdmin.publishFairSource('fair-trusted', 'publish', user))
    await assertAllowed('政策 · 可信机构可以发布', () => f.policies.publishPolicy('policy-trusted', 'publish', user))
    await assertAllowed('企业资料 · 可信机构可以发布', () => f.companies.adminPublish('company-trusted', { publish: true }, user))
    await assertAllowed('招聘会资料 · 可信机构可以发布', () => f.materials.publishMaterial('fair-trusted', 'mat-trusted', 'publish', user))
    await assertAllowed('线下机构 · 可信来源机构可以发布', () => f.agencies.adminPublish('agency-trusted', 'published'))
    await assertAllowed('线下机构 · 无来源机构的自录目录不受闸门影响', () => f.agencies.adminPublish('agency-selfauthored', 'published'))

    assert('岗位状态确实变成 published', f.job.rows.find((r) => r.id === 'job-trusted')?.publishStatus === 'published')
    assert('招聘会状态确实变成 published', f.jobFair.rows.find((r) => r.id === 'fair-trusted')?.publishStatus === 'published')
    assert('政策状态确实变成 published', f.policyPost.rows.find((r) => r.id === 'policy-trusted')?.publishStatus === 'published')
    assert('企业状态确实变成 published', f.companyProfile.rows.find((r) => r.id === 'company-trusted')?.publishStatus === 'published')
    assert('资料状态确实变成 published', f.fairMaterial.rows.find((r) => r.id === 'mat-trusted')?.publishStatus === 'published')
    assert('线下机构状态确实变成 published', f.offlineAgency.rows.find((r) => r.id === 'agency-trusted')?.publishStatus === 'published')
    assert('放行路径照常写审计', auditWrites.filter((a) => /publish/.test(a.action)).length >= 4)
  }

  // ── ⑤ unpublish 不受闸门限制(事故处置能力)────────────────────────────────
  console.log('\n[4] 下架(unpublish)不受闸门限制 —— 否则不可信内容撤不下来')
  {
    const f = buildFixture()
    f.job.rows.find((r) => r.id === 'job-null')!.publishStatus = 'published'
    f.jobFair.rows.find((r) => r.id === 'fair-null')!.publishStatus = 'published'
    f.policyPost.rows.find((r) => r.id === 'policy-null')!.publishStatus = 'published'
    f.companyProfile.rows.find((r) => r.id === 'company-null')!.publishStatus = 'published'

    await assertAllowed('岗位 · 不可信机构的已发布内容仍可下架', () => f.jobsAdmin.publishJobSource('job-null', 'unpublish', user))
    await assertAllowed('招聘会 · 同上', () => f.jobsAdmin.publishFairSource('fair-null', 'unpublish', user))
    await assertAllowed('政策 · 同上', () => f.policies.publishPolicy('policy-null', 'unpublish', user))
    await assertAllowed('企业资料 · 同上', () => f.companies.adminPublish('company-null', { publish: false }, user))
    assert('下架后状态是 unpublished', f.job.rows.find((r) => r.id === 'job-null')?.publishStatus === 'unpublished')

    // 事故的复发路径:下架后落回 draft/unpublished 候选池,再点批量发布
    await assertDeniedByGate('下架后重新单条发布仍被拒(复发路径已封死)', () => f.jobsAdmin.publishJobSource('job-null', 'publish', user))
  }

  // ── ② 批量发布:预览阶段就排除,执行阶段也拒 ──────────────────────────────
  console.log('\n[5] 批量发布:预览阶段进 excluded 统计,执行阶段逐条被拒')
  {
    const f = buildFixture()
    const pv = await f.bulk.previewBulkPublish({ kind: 'job' })
    const ids = pv.items.map((i) => i.id).sort()

    assert('候选只剩可信机构的条目', JSON.stringify(ids) === JSON.stringify(['job-trusted']), `实际 ${JSON.stringify(ids)}`)
    assert('eligibleTotal = 1', pv.eligibleTotal === 1, `实际 ${pv.eligibleTotal}`)
    assert(
      'excluded.orgTrustInactive = 4(null/suspended/archived/机构不存在)',
      pv.excluded.orgTrustInactive === 4,
      `实际 ${pv.excluded.orgTrustInactive}`,
    )
    assert('预览仍然是只读的(零审计写入)', auditWrites.length === 0, `实际 ${auditWrites.length}`)

    const fairPv = await f.bulk.previewBulkPublish({ kind: 'fair' })
    assert('招聘会预览同样只剩可信条目', JSON.stringify(fairPv.items.map((i) => i.id)) === JSON.stringify(['fair-trusted']))
    const policyPv = await f.bulk.previewBulkPublish({ kind: 'policy' })
    assert('政策预览同样只剩可信条目', JSON.stringify(policyPv.items.map((i) => i.id)) === JSON.stringify(['policy-trusted']))

    // 按不可信机构筛选 → 候选为空,但 excluded 说明了原因(不静默返回空)
    const scoped = await f.bulk.previewBulkPublish({ kind: 'job', sourceOrgId: ORG_NULL })
    assert('按不可信机构筛选:候选为空', scoped.items.length === 0)
    assert('按不可信机构筛选:excluded.orgTrustInactive = 1(如实说明为什么空)', scoped.excluded.orgTrustInactive === 1, `实际 ${scoped.excluded.orgTrustInactive}`)

    // 回归:信任过滤不得把操作者自己的 sourceOrgId 筛选覆盖掉
    const scopedTrusted = await f.bulk.previewBulkPublish({ kind: 'job', sourceOrgId: ORG_TRUSTED })
    assert('按可信机构筛选:仍然只返回该机构的条目(信任过滤没覆盖掉机构筛选)', JSON.stringify(scopedTrusted.items.map((i) => i.id)) === JSON.stringify(['job-trusted']), `实际 ${JSON.stringify(scopedTrusted.items.map((i) => i.id))}`)
    assert('按可信机构筛选:excluded.orgTrustInactive = 0', scopedTrusted.excluded.orgTrustInactive === 0, `实际 ${scopedTrusted.excluded.orgTrustInactive}`)

    // 即便绕过预览、直接把 id 塞进 execute,也走同一条闸门
    const exec = await f.bulk.executeBulkPublish('job', ['job-trusted', 'job-null', 'job-suspended', 'job-archived'], user)
    assert('执行:1 条成功', exec.publishedCount === 1, `实际 ${exec.publishedCount}`)
    assert('执行:3 条失败', exec.failedCount === 3, `实际 ${exec.failedCount}`)
    const denied = exec.results.filter((r) => r.errorCode === CONTENT_TRUST_DENIED_CODE)
    assert('失败明细的错误码正是闸门那一条', denied.length === 3, `实际 ${denied.length}`)
    assert('失败明细带人类可读原因', denied.every((r) => (r.errorMessage ?? '').includes('内容信任') || (r.errorMessage ?? '').includes('归档')))
    assert(
      '不可信条目状态没被改动',
      ['job-null', 'job-suspended', 'job-archived'].every((id) => f.job.rows.find((r) => r.id === id)?.publishStatus === 'draft'),
    )
  }

  // ── ⑦ 标记入口:唯一能解锁发布的人工动作 ──────────────────────────────────
  console.log('\n[6] 标记入口:Admin 标 active 之后,原本被拒的内容才能发布')
  {
    const f = buildFixture()
    const trustSvc = new AdminOrgContentTrustService(f.prisma, fakeAudit)

    await assertDeniedByGate('标记前:该机构的岗位发不了', () => f.jobsAdmin.publishJobSource('job-null', 'publish', user))

    // active 必须给依据 —— 没有依据的 active 等于把闸门当摆设
    let reasonRequired = ''
    try {
      await trustSvc.setContentTrust(ORG_NULL, { status: 'active' }, user)
    } catch (e) { reasonRequired = errorOf(e).code }
    assert('标 active 未填核验依据 → CONTENT_TRUST_REASON_REQUIRED', reasonRequired === 'CONTENT_TRUST_REASON_REQUIRED', `实际 ${reasonRequired}`)

    let archivedRejected = ''
    try {
      await trustSvc.setContentTrust(ORG_ARCHIVED, { status: 'active', reason: '授权书 X-1' }, user)
    } catch (e) { archivedRejected = errorOf(e).code }
    assert('已归档机构不得标 active → ORG_ARCHIVED', archivedRejected === 'ORG_ARCHIVED', `实际 ${archivedRejected}`)

    const view = await trustSvc.setContentTrust(ORG_NULL, { status: 'active', reason: '2026-08 授权书 XX-123' }, user)
    assert('标记后 contentTrustStatus=active', view.contentTrustStatus === 'active')
    assert('标记写了 contentTrustReviewedBy', view.contentTrustReviewedBy === user.userId)
    assert('标记写了 contentTrustReviewedAt', typeof view.contentTrustReviewedAt === 'string' && view.contentTrustReviewedAt.length > 0)
    assert('标记写了 contentTrustReason', view.contentTrustReason === '2026-08 授权书 XX-123')
    assert('标记写了审计 organization.content_trust', auditWrites.some((a) => a.action === 'organization.content_trust' && a.targetId === ORG_NULL))

    await assertAllowed('标记后:同一条岗位可以发布了(闸门是可解锁的,不是死锁)', () => f.jobsAdmin.publishJobSource('job-null', 'publish', user))

    // 撤销信任后立刻恢复拦截
    await trustSvc.setContentTrust(ORG_NULL, { status: 'revoked', reason: '授权到期' }, user)
    await assertDeniedByGate('撤销信任后:该机构的其它内容重新被拒', () => f.jobsAdmin.publishFairSource('fair-null', 'publish', user))
  }

  // ── ⑥ 源码层清单 ─────────────────────────────────────────────────────────
  console.log('\n[7] 源码层:没有第二条绕过闸门的发布路径')
  checkSourceInventory()

  console.log(`\n结果: ${passed} PASS / ${failed} FAIL`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
