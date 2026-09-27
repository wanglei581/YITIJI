import { ForbiddenException } from '@nestjs/common'
import {
  isRecruitmentContentHostingEnabled,
  recruitmentHostingDisabledException,
} from '../../recruitment-hosting/recruitment-hosting'
import { KIOSK_JOB_BOARD_DISABLED_CODE } from '../../terminals/kiosk-job-board.service'

/**
 * 岗位匹配存档是否引用了系统内岗位。
 * 手填岗位没有 job.id；解析失败按系统内岗位处理，避免坏档在托管关闭时被放行。
 */
export function storedJobFitUsesSystemJob(payloadJson: string | null | undefined): boolean {
  if (!payloadJson) return true
  try {
    const stored = JSON.parse(payloadJson) as { job?: { id?: unknown } }
    return typeof stored.job?.id === 'string' && stored.job.id.trim().length > 0
  } catch {
    return true
  }
}

/** 托管关闭时，只有手填岗位的存档可以查看或打印。 */
export function assertStoredJobFitReadable(payloadJson: string | null | undefined): void {
  if (isRecruitmentContentHostingEnabled()) return
  if (storedJobFitUsesSystemJob(payloadJson)) throw recruitmentHostingDisabledException()
}

/**
 * 岗位板块关闭时，同样只拒绝系统内岗位存档。手填存档始终放行。
 * 与上面的托管判断放在一起：都是先读存档，再按来源决定。
 */
export function assertStoredJobFitJobBoardOpen(
  payloadJson: string | null | undefined,
  jobBoardOpen: boolean,
): void {
  if (jobBoardOpen) return
  if (!storedJobFitUsesSystemJob(payloadJson)) return
  throw new ForbiddenException({
    error: { code: KIOSK_JOB_BOARD_DISABLED_CODE, message: '岗位板块已关闭' },
  })
}

type JobFitFileReadPrisma = {
  auditLog: {
    findFirst: (args: {
      where: { action: string; payloadJson: { contains: string } }
      orderBy: { createdAt: 'desc' }
      select: { targetId: true }
    }) => Promise<{ targetId: string | null } | null>
  }
  aiResumeResult: {
    findUnique: (args: {
      where: { taskId_kind: { taskId: string; kind: string } }
      select: { payloadJson: true }
    }) => Promise<{ payloadJson: string } | null>
  }
}

/**
 * 已生成的岗位匹配 PDF 按同一规则：先凭打印审计找回任务，再读存档。
 * 找不到存档时拒绝，不把来源不明的报告当成手填结果。
 */
export async function assertJobFitPrintFileReadable(
  prisma: JobFitFileReadPrisma,
  file: { id: string; createdBy: string | null },
): Promise<void> {
  if (isRecruitmentContentHostingEnabled()) return
  if (file.createdBy !== 'job_fit') return
  const audit = await prisma.auditLog.findFirst({
    where: { action: 'resume.job_fit_print', payloadJson: { contains: file.id } },
    orderBy: { createdAt: 'desc' },
    select: { targetId: true },
  })
  if (!audit?.targetId) throw recruitmentHostingDisabledException()
  const row = await prisma.aiResumeResult.findUnique({
    where: { taskId_kind: { taskId: audit.targetId, kind: 'job_fit' } },
    select: { payloadJson: true },
  })
  assertStoredJobFitReadable(row?.payloadJson ?? null)
}
