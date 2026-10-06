import type { AuditService } from '../../audit/audit.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { resumeExportShowsVisibleLabel, resumeUnlabeledOptionEnabled } from '../../common/pdf/aigc-label'

// ============================================================
// 简历导出「不带显式标识」的准入判定与留痕（C8，标识办法第九条）。
//
// 第九条允许应用户申请提供不含显式标识的内容，前提是：用户协议写明用户的标识义务
// 与使用责任，并留存提供对象等日志不少于六个月。因此这里只放行同时满足下列条件的请求：
//   1. RESUME_EXPORT_UNLABELED_OPTION 打开（它又要求 RESUME_EXPORT_VISIBLE_LABEL 打开）；
//   2. 格式是 PDF 或 Word（docx）。TXT / MD 没有隐式标识，申请不印一律不放行，照常印显式标识；
//   3. 不是原样草稿（草稿本来就不印标识）；
//   4. 登录会员 —— 匿名导出没有「提供对象」可记，一律照常带标识；
//   5. 该会员最近一次登录同意的，正是**当前生效**的正式协议版本 —— 草稿兜底版本不算；
//      协议改版（例如加进标识义务条款）后还没重新登录同意新版的，也不算。
// 不满足时不报错，照常导出带标识的版本，并在导出审计里记下没放行的原因。
//
// 放行时先写一条必须成功的留痕（writeRequired），写不进去就抛错、不导出。
// actorId 只能填运营账号（外键指向 User），会员 ID 放在 payload 里。
// 终端只记编号（terminalCode）；没有已验签的一体机终端身份时为 null。不记其它终端信息。
// ============================================================

export type UnlabeledExportDeniedReason =
  | 'not_requested'
  | 'option_off'
  | 'format_not_eligible'
  | 'draft'
  | 'anonymous'
  | 'terms_not_accepted'
  | 'terms_outdated'

/** 导出响应里的未放行原因。没申请时响应为 null，不把 not_requested 交出去。 */
export type UnlabeledExportPublicDeniedReason = Exclude<UnlabeledExportDeniedReason, 'not_requested'>

const UNLABELED_ELIGIBLE_FORMATS = new Set(['pdf', 'docx'])

export type UnlabeledExportDecision =
  | { applied: true; endUserId: string; termsVersion: string; termsDocVersionId: string }
  | { applied: false; reason: UnlabeledExportDeniedReason }

/** 只收终端编号字符串。空白、非字符串一律当成没有终端身份。 */
export function normalizeExportTerminalCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim()
  return code.length > 0 ? code : null
}

/**
 * 从已验签的一体机终端 id 取终端编号。
 * 没带身份、查不到、编号为空、或查询失败，都是 null。失败不抛，以免挡住照常导出。
 * select 只有 terminalCode，不把机构、点位或其它终端字段带出来。
 */
export async function lookupExportTerminalCode(
  prisma: Pick<PrismaService, 'terminal'>,
  terminalId: string | null,
): Promise<string | null> {
  if (!terminalId) return null
  try {
    const row = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { terminalCode: true },
    })
    return normalizeExportTerminalCode(row?.terminalCode)
  } catch {
    return null
  }
}

export async function decideUnlabeledExport(
  prisma: Pick<PrismaService, 'memberLegalConsent' | 'legalDocVersion'>,
  input: { requested: boolean; draft: boolean; endUserId: string | null; format: string },
): Promise<UnlabeledExportDecision> {
  if (!input.requested) return { applied: false, reason: 'not_requested' }
  if (!resumeUnlabeledOptionEnabled()) return { applied: false, reason: 'option_off' }
  // 选项开着才谈格式。TXT / MD 在这之后一律不放行，不再继续看会员或协议。
  if (!UNLABELED_ELIGIBLE_FORMATS.has(input.format)) return { applied: false, reason: 'format_not_eligible' }
  if (input.draft) return { applied: false, reason: 'draft' }
  if (!input.endUserId) return { applied: false, reason: 'anonymous' }
  const [consent, activeTerms] = await Promise.all([
    prisma.memberLegalConsent.findFirst({
      where: { endUserId: input.endUserId },
      orderBy: { createdAt: 'desc' },
      select: { termsVersion: true, termsDocVersionId: true },
    }),
    prisma.legalDocVersion.findFirst({
      where: { docType: 'terms_of_service', isActive: true },
      select: { id: true },
    }),
  ])
  if (!consent?.termsDocVersionId) return { applied: false, reason: 'terms_not_accepted' }
  if (!activeTerms || consent.termsDocVersionId !== activeTerms.id) return { applied: false, reason: 'terms_outdated' }
  return {
    applied: true,
    endUserId: input.endUserId,
    termsVersion: consent.termsVersion,
    termsDocVersionId: consent.termsDocVersionId,
  }
}

export function visibleLabelForDecision(draft: boolean, decision: UnlabeledExportDecision): boolean {
  return resumeExportShowsVisibleLabel({ draft, unlabeled: decision.applied })
}

export function publicDeniedReason(decision: UnlabeledExportDecision): UnlabeledExportPublicDeniedReason | null {
  if (decision.applied || decision.reason === 'not_requested') return null
  return decision.reason
}

export interface UnlabeledExportPlan {
  applied: boolean
  /** 合进导出审计 resume.generate_exported 的 payload 字段；动作名不变，去标识与否看 unlabeledApplied。 */
  auditPayload: Record<string, unknown>
  /** 这一份文件是否印了显式标识。与渲染用的是同一个判定。 */
  visibleLabelApplied: boolean
  /** 申请了但没放行的原因；没申请或已放行为 null。 */
  unlabeledDeniedReason: UnlabeledExportPublicDeniedReason | null
  /** 已验签一体机的终端编号；没有则为 null。 */
  terminalCode: string | null
}

export async function prepareUnlabeledExport(
  deps: { prisma: PrismaService; audit: AuditService },
  input: {
    requested: boolean
    draft: boolean
    endUserId: string | null
    taskId: string | null
    format: string
    terminalCode: string | null
  },
  meta: { ipAddress: string | null; userAgent: string | null; requestId: string | null },
): Promise<UnlabeledExportPlan> {
  const terminalCode = normalizeExportTerminalCode(input.terminalCode)
  const decision = await decideUnlabeledExport(deps.prisma, input)
  const visibleLabelApplied = visibleLabelForDecision(input.draft, decision)
  const unlabeledDeniedReason = publicDeniedReason(decision)
  if (!decision.applied) {
    return {
      applied: false,
      visibleLabelApplied,
      unlabeledDeniedReason,
      terminalCode,
      auditPayload: input.requested
        ? { unlabeledRequested: true, unlabeledApplied: false, unlabeledDeniedReason: decision.reason, terminalCode }
        : { terminalCode },
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
      terminalCode,
    },
    ...meta,
  })
  return {
    applied: true,
    visibleLabelApplied,
    unlabeledDeniedReason: null,
    terminalCode,
    auditPayload: {
      unlabeledRequested: true,
      unlabeledApplied: true,
      endUserId: decision.endUserId,
      termsVersion: decision.termsVersion,
      unlabeledRequestRef: requestRef,
      terminalCode,
    },
  }
}
