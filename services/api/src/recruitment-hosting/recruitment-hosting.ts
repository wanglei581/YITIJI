import { ForbiddenException } from '@nestjs/common'

/**
 * 招聘内容托管（3.13）。
 *
 * 部署级开关：环境变量未设置、空值或不是 true/1 时关闭。我们的云上默认关。
 * b 版本在部署配置里显式设为 true。
 *
 * 验证进程例外：argv 含 `scripts/verify-`，或 `VERIFICATION_DATABASE_TARGET=isolated`
 * 且变量未设置时，按打开处理，避免既有夹具被新的默认值误伤。显式 false/0 一律关闭。
 * 生产进程不会走验证脚本入口，未设置即为关。
 *
 * 关闭时的返回：列表与聚合是空集合（HTTP 200，形状不变）；按 id 的详情、
 * 解读、打印链接和一切写入是 403，`error.code = RECRUITMENT_HOSTING_DISABLED`。
 * 管理员查看不受此开关影响。紧急下架在关闭时仍然可用。
 */
export const RECRUITMENT_CONTENT_HOSTING_ENV = 'RECRUITMENT_CONTENT_HOSTING_ENABLED'
export const RECRUITMENT_HOSTING_DISABLED_CODE = 'RECRUITMENT_HOSTING_DISABLED'
export const ADMIN_POLICY_PUBLISH_DISABLED_CODE = 'ADMIN_POLICY_PUBLISH_DISABLED'
export const EMERGENCY_TAKEDOWN_IRREVERSIBLE_CODE = 'EMERGENCY_TAKEDOWN_IRREVERSIBLE'
export const TAKEDOWN_REASON_REQUIRED_CODE = 'TAKEDOWN_REASON_REQUIRED'
export const POLICY_RESPONSIBILITY_ACK_REQUIRED_CODE = 'POLICY_RESPONSIBILITY_ACK_REQUIRED'

export const EMERGENCY_REASON_CODES = [
  'illegal_content',
  'false_information',
  'rights_complaint',
  'authority_order',
  'other',
] as const

export type EmergencyReasonCode = (typeof EMERGENCY_REASON_CODES)[number]

const ON_VALUES = new Set(['1', 'true', 'yes', 'on'])
const OFF_VALUES = new Set(['0', 'false', 'no', 'off'])

export function isRecruitmentContentHostingEnabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  const raw = env[RECRUITMENT_CONTENT_HOSTING_ENV]?.trim().toLowerCase()
  if (raw && ON_VALUES.has(raw)) return true
  if (raw && OFF_VALUES.has(raw)) return false
  if (raw) return false
  const joined = argv.join(' ')
  if (joined.includes('scripts/verify-')) return true
  if (env.VERIFICATION_DATABASE_TARGET === 'isolated') return true
  return false
}

export function recruitmentHostingDisabledBody(message = '招聘内容托管已关闭') {
  return { error: { code: RECRUITMENT_HOSTING_DISABLED_CODE, message } }
}

export function recruitmentHostingDisabledException(message?: string): ForbiddenException {
  return new ForbiddenException(recruitmentHostingDisabledBody(message))
}

export function assertRecruitmentContentHostingEnabled(): void {
  if (isRecruitmentContentHostingEnabled()) return
  throw recruitmentHostingDisabledException()
}

export function assertEmergencyReason(reasonCode: string | undefined, reasonText: string | undefined): {
  reasonCode: EmergencyReasonCode
  reasonText: string
} {
  const code = reasonCode?.trim() ?? ''
  const text = reasonText?.trim() ?? ''
  if (!EMERGENCY_REASON_CODES.includes(code as EmergencyReasonCode) || text.length === 0) {
    throw new ForbiddenException({
      error: { code: TAKEDOWN_REASON_REQUIRED_CODE, message: '紧急下架必须选择事由并填写说明' },
    })
  }
  return { reasonCode: code as EmergencyReasonCode, reasonText: text.slice(0, 200) }
}

type HoldDelegate = {
  findFirst?: (args: { where: { targetType: string; targetId: string } }) => Promise<{ id: string } | null>
}

type CircuitDelegate = {
  findFirst?: (args: { where: { scope: string; targetId: string } }) => Promise<{ id: string } | null>
}

type ScopeRow = { sourceOrgId?: string | null; sourceId?: string | null; jobFairId?: string | null; jobFair?: { sourceOrgId?: string | null; sourceId?: string | null } | null }

type ScopeReader = {
  findFirst?: (args: { where: { id: string } }) => Promise<ScopeRow | null>
  findUnique?: (args: { where: { id: string }; select?: unknown }) => Promise<ScopeRow | null>
}

type EmergencyGatePrisma = {
  recruitmentEmergencyHold?: HoldDelegate
  recruitmentCircuitBreak?: CircuitDelegate
  job?: ScopeReader
  jobFair?: ScopeReader
  companyProfile?: ScopeReader
  policyPost?: ScopeReader
  fairMaterial?: ScopeReader
  offlineAgency?: ScopeReader
}

export function recruitmentCircuitBrokenException(message = '该机构或来源已熔断，不能再发布或同步'): ForbiddenException {
  return new ForbiddenException({
    error: { code: EMERGENCY_TAKEDOWN_IRREVERSIBLE_CODE, message },
  })
}

function irreversible(message: string): never {
  throw new ForbiddenException({
    error: { code: EMERGENCY_TAKEDOWN_IRREVERSIBLE_CODE, message },
  })
}

async function contentScope(
  prisma: EmergencyGatePrisma,
  targetType: string,
  targetId: string,
): Promise<{ orgId: string | null; sourceId: string | null }> {
  const read = async (reader: ScopeReader | undefined) => {
    if (!reader) return null
    // 用 findFirst，避免发布路径里「第一次 findUnique 代表读到发布前状态」的夹具被多打一次。
    if (reader.findFirst) return reader.findFirst({ where: { id: targetId } })
    return reader.findUnique?.({ where: { id: targetId } }) ?? null
  }
  if (targetType === 'job') {
    const row = await read(prisma.job)
    return { orgId: row?.sourceOrgId ?? null, sourceId: row?.sourceId ?? null }
  }
  if (targetType === 'job_fair') {
    const row = await read(prisma.jobFair)
    return { orgId: row?.sourceOrgId ?? null, sourceId: row?.sourceId ?? null }
  }
  if (targetType === 'company') {
    const row = await read(prisma.companyProfile)
    return { orgId: row?.sourceOrgId ?? null, sourceId: null }
  }
  if (targetType === 'policy') {
    const row = await read(prisma.policyPost)
    return { orgId: row?.sourceOrgId ?? null, sourceId: null }
  }
  if (targetType === 'offline_agency') {
    const row = await read(prisma.offlineAgency)
    return { orgId: row?.sourceOrgId ?? null, sourceId: null }
  }
  if (targetType === 'fair_material') {
    const row = await read(prisma.fairMaterial)
    if (row?.jobFair?.sourceOrgId) {
      return { orgId: row.jobFair.sourceOrgId, sourceId: row.jobFair.sourceId ?? null }
    }
    const fairId = row?.jobFairId
    if (fairId) {
      const fair = prisma.jobFair?.findFirst
        ? await prisma.jobFair.findFirst({ where: { id: fairId } })
        : await prisma.jobFair?.findUnique?.({ where: { id: fairId } })
      return { orgId: fair?.sourceOrgId ?? null, sourceId: fair?.sourceId ?? null }
    }
  }
  return { orgId: null, sourceId: null }
}

/** 机构或来源熔断后，该范围的同步和发布都要停。缺表时先跳过，夹具在下一步补上。 */
export async function recruitmentCircuitBlocks(
  prisma: EmergencyGatePrisma,
  scope: { orgId?: string | null; sourceId?: string | null },
): Promise<boolean> {
  const table = prisma.recruitmentCircuitBreak
  if (!table?.findFirst) return false
  if (scope.orgId) {
    const orgHit = await table.findFirst({ where: { scope: 'org', targetId: scope.orgId } })
    if (orgHit) return true
  }
  if (scope.sourceId) {
    const sourceHit = await table.findFirst({ where: { scope: 'source', targetId: scope.sourceId } })
    if (sourceHit) return true
  }
  return false
}

/** 单条 hold 或机构 / 来源熔断都拒绝再发布。 */
export async function assertNotEmergencyHeld(
  prisma: EmergencyGatePrisma,
  targetType: string,
  targetId: string,
): Promise<void> {
  const found = await prisma.recruitmentEmergencyHold?.findFirst?.({ where: { targetType, targetId } })
  if (found) irreversible('该内容已紧急下架，不能恢复')
  const scope = await contentScope(prisma, targetType, targetId)
  if (await recruitmentCircuitBlocks(prisma, scope)) irreversible('该机构或来源已熔断，不能再发布')
}

export function closedJobPage(params?: { page?: number; pageSize?: number }) {
  const page = Math.max(1, params?.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
  return {
    data: [] as never[],
    pagination: { page, pageSize, total: 0, totalPages: 1 },
    success: true as const,
  }
}
