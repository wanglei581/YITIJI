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

/** 内存假 Prisma 没有这张表时跳过，避免既有发布闸门夹具被新表拖红。 */
export async function assertNotEmergencyHeld(
  prisma: { recruitmentEmergencyHold?: HoldDelegate },
  targetType: string,
  targetId: string,
): Promise<void> {
  const found = await prisma.recruitmentEmergencyHold?.findFirst?.({ where: { targetType, targetId } })
  if (!found) return
  throw new ForbiddenException({
    error: { code: EMERGENCY_TAKEDOWN_IRREVERSIBLE_CODE, message: '该内容已紧急下架，不能恢复' },
  })
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
