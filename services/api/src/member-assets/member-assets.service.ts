import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'
import type {
  MemberAiRecordItem,
  MemberAssetPage,
  MemberDocumentItem,
  MemberResumeItem,
} from './member-assets.types'
import { allowedPoliciesForFile, isVisibleMemberFileWhere } from '../files/retention-policy'

// ============================================================
// 会员个人资产中心服务（Phase C-2B 只读 → C-2D 真实管理）
//
// 全部读写都以传入的 endUserId（来自 EndUserAuthGuard 注入的 req.endUser）为唯一过滤维度：
// 只操作**本人**资产，跨用户 / 匿名在 controller 层（guard）就已拒绝，service 永远拿到的是
// 已认证的 endUserId，绝不接受任意 id 参数 → 天然杜绝越权。
//
// 留存治理对齐（CLAUDE.md §11，与 C-2A loadAuthorizedResult 一致）：
// - AiResumeResult：仅返回未过期（expiresAt > now）行；expiresAt 为 null 的迁移前历史行
//   按「已过期」处理，不返回（`{ gt: now }` 自动排除 null）。
// - FileObject：仅返回 active、未软删、未过期的文件；expiresAt=null 在 FileObject
//   中表示 long_term 长期保存，必须继续显示。
//
// 分页（C-2D）：所有列表走游标分页（take pageSize+1，封顶 50），绝不无界 findMany。
//
// 删除语义（C-2D，明确软删/硬删规则）：
// - AI 记录（AiResumeResult）：**硬删**。payloadJson 含简历敏感内容，本就有 TTL 自动清理，
//   会员主动删除 = 立即物理删除 DB 行；删除动作由 controller 写审计日志留痕。
// - 文档（FileObject）：走 FilesService.ownerDelete（对象存储**物理删除** + DB 行软删保留
//   删除日志字段），不在本 service 重复实现。
//
// 只回元数据：select 显式列出安全字段，绝不 select payloadJson / storageKey / sha256 /
// accessTokenHash 等敏感列；文件不回内容，只给换取短期签名 URL 的端点路径。
// ============================================================

/** 简历资产包含的 AiResumeResult 种类：parse=上传诊断，generate=AI 生成。 */
const RESUME_KINDS = ['parse', 'generate'] as const

@Injectable()
export class MemberAssetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的简历：本人 parse（上传诊断，附「是否已生成优化版」）+ generate（AI 生成）列表。 */
  async listResumes(endUserId: string, page: MemberPageQuery): Promise<MemberAssetPage<MemberResumeItem>> {
    const where = { endUserId, kind: { in: [...RESUME_KINDS] }, expiresAt: { gt: new Date() } }
    const total = await this.prisma.aiResumeResult.count({ where })
    const rows = await this.prisma.aiResumeResult.findMany({
      where,
      select: { id: true, taskId: true, kind: true, status: true, provider: true, createdAt: true, updatedAt: true, expiresAt: true },
      ...memberPageArgs(page),
    })
    // 仅查当前页 parse 行对应的 optimize 行（同样限定本人），标注「已生成优化版」。
    const parseTaskIds = rows.filter((r) => r.kind === 'parse').map((r) => r.taskId)
    const optimizedTaskIds = new Set(
      parseTaskIds.length === 0
        ? []
        : (
            await this.prisma.aiResumeResult.findMany({
              where: { endUserId, kind: 'optimize', taskId: { in: parseTaskIds } },
              select: { taskId: true },
            })
          ).map((r) => r.taskId),
    )
    return buildMemberPage(rows, page, total, (r) => ({
      id: r.id,
      taskId: r.taskId,
      kind: r.kind === 'generate' ? ('generate' as const) : ('parse' as const),
      status: r.status,
      provider: r.provider,
      optimized: r.kind === 'parse' && optimizedTaskIds.has(r.taskId),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    }))
  }

  /** 我的文档：本人 FileObject（仅元数据 + 临时访问端点路径，无文件内容）。 */
  async listDocuments(endUserId: string, page: MemberPageQuery): Promise<MemberAssetPage<MemberDocumentItem>> {
    const where = isVisibleMemberFileWhere(endUserId, new Date())
    const total = await this.prisma.fileObject.count({ where })
    const rows = await this.prisma.fileObject.findMany({
      where,
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        purpose: true, sensitiveLevel: true, assetCategory: true, retentionPolicy: true, createdAt: true, expiresAt: true,
      },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      purpose: f.purpose,
      sensitiveLevel: f.sensitiveLevel,
      assetCategory: f.assetCategory as MemberDocumentItem['assetCategory'],
      retentionPolicy: f.retentionPolicy as MemberDocumentItem['retentionPolicy'],
      allowedRetentionPolicies: allowedPoliciesForFile({
        purpose: f.purpose,
        assetCategory: f.assetCategory,
      }) as MemberDocumentItem['allowedRetentionPolicies'],
      createdAt: f.createdAt.toISOString(),
      expiresAt: f.expiresAt ? f.expiresAt.toISOString() : null,
      // 必要的临时访问能力：会员带本人 token 调既有端点换取 TTL 受控签名 URL。
      downloadUrlPath: `/files/${f.id}/download-url`,
      previewUrlPath: `/files/${f.id}/preview-url`,
    }))
  }

  /** AI 服务记录：本人 AiResumeResult(parse / optimize / generate) 调用历史元数据（不含 payload）。 */
  async listAiRecords(endUserId: string, page: MemberPageQuery): Promise<MemberAssetPage<MemberAiRecordItem>> {
    const where = { endUserId, expiresAt: { gt: new Date() } }
    const total = await this.prisma.aiResumeResult.count({ where })
    const rows = await this.prisma.aiResumeResult.findMany({
      where,
      select: { id: true, taskId: true, kind: true, status: true, provider: true, createdAt: true, expiresAt: true },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r) => ({
      id: r.id,
      taskId: r.taskId,
      // generate 必须如实展示为「生成」，绝不冒充「解析」（C-2D 验收点）。
      kind: r.kind === 'optimize' || r.kind === 'generate' || r.kind === 'job_fit' || r.kind === 'career_plan' || r.kind === 'fair_visit_plan' ? r.kind : ('parse' as const),
      status: r.status,
      provider: r.provider,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    }))
  }

  /**
   * 删除本人一条 AI 记录（硬删，含级联）。
   *
   * - 归属：findFirst 同时限定 id + endUserId；删他人 / 不存在统一 404（不泄露是否存在）。
   * - 级联策略：删除 parse 行时，同 taskId 的全部 AiResumeResult 派生行及全部
   *   JobAiSession 一并物理删除；删除 job_fit 行时仅清该行与同 task 的 match 会话。
   *   其余 kind 只删自身。上述结果与会话删除均在同一事务中完成。
   * - deleteMany 仍带 endUserId 双保险，绝不可能删到他人行。
   * - 导出的 PDF 是独立 FileObject（「我的文档」管理），不在此级联。
   */
  async deleteAiRecord(
    endUserId: string,
    recordId: string,
  ): Promise<{ deleted: true; taskId: string; kind: string; deletedCount: number }> {
    const deletion = await this.prisma.$transaction(async (tx) => {
      const row = await tx.aiResumeResult.findFirst({
        where: { id: recordId, endUserId },
        select: { id: true, taskId: true, kind: true },
      })
      if (!row) return null
      const results = await tx.aiResumeResult.deleteMany({
        where: row.kind === 'parse'
          ? { endUserId, taskId: row.taskId }
          : { endUserId, id: row.id },
      })
      // 并发删除已先一步移除目标时，不得再按 taskId 清理会话。
      if (results.count === 0) return null
      if (row.kind === 'parse') {
        await tx.jobAiSession.deleteMany({ where: { endUserId, resumeTaskId: row.taskId } })
      } else if (row.kind === 'job_fit') {
        await tx.jobAiSession.deleteMany({
          where: { endUserId, resumeTaskId: row.taskId, operation: 'match' },
        })
      }
      return { row, deletedCount: results.count }
    })
    if (!deletion) {
      throw new NotFoundException({
        error: { code: 'MEMBER_RECORD_NOT_FOUND', message: '记录不存在或已删除' },
      })
    }
    return {
      deleted: true,
      taskId: deletion.row.taskId,
      kind: deletion.row.kind,
      deletedCount: deletion.deletedCount,
    }
  }
}
