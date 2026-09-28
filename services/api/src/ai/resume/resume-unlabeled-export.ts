import type { AuditService } from '../../audit/audit.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { resumeUnlabeledOptionEnabled } from '../../common/pdf/aigc-label'

// ============================================================
// 简历导出「不带显式标识」的准入判定与留痕（C8，标识办法第九条）。
//
// 第九条允许应用户申请提供不含显式标识的内容，前提是：用户协议写明用户的标识义务
// 与使用责任，并留存提供对象等日志不少于六个月。因此这里只放行同时满足下列条件的请求：
//   1. RESUME_EXPORT_UNLABELED_OPTION 打开（它又要求 RESUME_EXPORT_VISIBLE_LABEL 打开）；
//   2. 不是原样草稿（草稿本来就不印标识）；
//   3. 登录会员 —— 匿名导出没有「提供对象」可记，一律照常带标识；
//   4. 该会员最近一次登录同意的是已激活的正式协议版本（草稿兜底版本不算）。
// 不满足时不报错，照常导出带标识的版本，并在导出审计里记下没放行的原因。
//
// 放行时先写一条必须成功的留痕（writeRequired），写不进去就抛错、不导出。
// actorId 只能填运营账号（外键指向 User），会员 ID 放在 payload 里。
// ============================================================

export type UnlabeledExportDeniedReason =
  | 'not_requested'
  | 'option_off'
  | 'draft'
  | 'anonymous'
  | 'terms_not_accepted'

export type UnlabeledExportDecision =
  | { applied: true; endUserId: string; termsVersion: string; termsDocVersionId: string }
  | { applied: false; reason: UnlabeledExportDeniedReason }

export async function decideUnlabeledExport(
  prisma: Pick<PrismaService, 'memberLegalConsent'>,
  input: { requested: boolean; draft: boolean; endUserId: string | null },
): Promise<UnlabeledExportDecision> {
  if (!input.requested) return { applied: false, reason: 'not_requested' }
  if (!resumeUnlabeledOptionEnabled()) return { applied: false, reason: 'option_off' }
  if (input.draft) return { applied: false, reason: 'draft' }
  if (!input.endUserId) return { applied: false, reason: 'anonymous' }
  const consent = await prisma.memberLegalConsent.findFirst({
    where: { endUserId: input.endUserId },
    orderBy: { createdAt: 'desc' },
    select: { termsVersion: true, termsDocVersionId: true },
  })
  if (!consent?.termsDocVersionId) return { applied: false, reason: 'terms_not_accepted' }
  return {
    applied: true,
    endUserId: input.endUserId,
    termsVersion: consent.termsVersion,
    termsDocVersionId: consent.termsDocVersionId,
  }
}

export interface UnlabeledExportPlan {
  applied: boolean
  /** 合进导出审计 resume.generate_exported 的 payload 字段；动作名不变，去标识与否看 unlabeledApplied。 */
  auditPayload: Record<string, unknown>
}

export async function prepareUnlabeledExport(
  deps: { prisma: PrismaService; audit: AuditService },
  input: { requested: boolean; draft: boolean; endUserId: string | null; taskId: string | null; format: string },
  meta: { ipAddress: string | null; userAgent: string | null; requestId: string | null },
): Promise<UnlabeledExportPlan> {
  const decision = await decideUnlabeledExport(deps.prisma, input)
  if (!decision.applied) {
    return {
      applied: false,
      auditPayload: input.requested ? { unlabeledRequested: true, unlabeledApplied: false, unlabeledDeniedReason: decision.reason } : {},
    }
  }
  const requestRef = await deps.audit.writeRequired(deps.prisma, {
    actorId: null,
    actorRole: 'kiosk',
    action: 'resume.export_unlabeled_requested',
    targetType: 'file',
    targetId: null,
    payload: {
      endUserId: decision.endUserId,
      taskId: input.taskId,
      format: input.format,
      termsVersion: decision.termsVersion,
      termsDocVersionId: decision.termsDocVersionId,
    },
    ...meta,
  })
  return {
    applied: true,
    auditPayload: {
      unlabeledRequested: true,
      unlabeledApplied: true,
      endUserId: decision.endUserId,
      termsVersion: decision.termsVersion,
      unlabeledRequestRef: requestRef,
    },
  }
}
