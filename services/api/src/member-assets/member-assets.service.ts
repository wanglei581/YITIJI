import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { MemberAiRecordItem, MemberDocumentItem, MemberResumeItem } from './member-assets.types'

// ============================================================
// 会员个人资产中心只读服务（Phase C-2B）
//
// 全部查询都以传入的 endUserId（来自 EndUserAuthGuard 注入的 req.endUser）为唯一过滤维度：
// 只返回**本人**资产，跨用户 / 匿名在 controller 层（guard）就已拒绝，service 永远拿到的是
// 已认证的 endUserId，绝不接受任意 id 参数 → 天然杜绝越权。
//
// 留存治理对齐（CLAUDE.md §11，与 C-2A loadAuthorizedResult 一致）：
// - AiResumeResult：仅返回未过期（expiresAt > now）行；expiresAt 为 null 的迁移前历史行
//   按「已过期」处理，不返回（`{ gt: now }` 自动排除 null）。
// - FileObject：仅返回 active、未软删、未过期的文件。
//
// 只回元数据：select 显式列出安全字段，绝不 select payloadJson / storageKey / sha256 /
// accessTokenHash 等敏感列；文件不回内容，只给换取短期签名 URL 的端点路径。
// ============================================================

@Injectable()
export class MemberAssetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的简历：本人 AiResumeResult(parse) 列表，附「是否已生成优化版」。 */
  async listResumes(endUserId: string): Promise<MemberResumeItem[]> {
    const rows = await this.prisma.aiResumeResult.findMany({
      where: { endUserId, expiresAt: { gt: new Date() } },
      select: { id: true, taskId: true, kind: true, status: true, provider: true, createdAt: true, updatedAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    })
    const optimizedTaskIds = new Set(rows.filter((r) => r.kind === 'optimize').map((r) => r.taskId))
    return rows
      .filter((r) => r.kind === 'parse')
      .map((r) => ({
        id: r.id,
        taskId: r.taskId,
        status: r.status,
        provider: r.provider,
        optimized: optimizedTaskIds.has(r.taskId),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      }))
  }

  /** 我的文档：本人 FileObject（仅元数据 + 临时访问端点路径，无文件内容）。 */
  async listDocuments(endUserId: string): Promise<MemberDocumentItem[]> {
    const rows = await this.prisma.fileObject.findMany({
      where: { endUserId, status: 'active', deletedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        purpose: true, sensitiveLevel: true, createdAt: true, expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      purpose: f.purpose,
      sensitiveLevel: f.sensitiveLevel,
      createdAt: f.createdAt.toISOString(),
      expiresAt: f.expiresAt.toISOString(),
      // 必要的临时访问能力：会员带本人 token 调既有端点换取 TTL 受控签名 URL。
      downloadUrlPath: `/files/${f.id}/download-url`,
      previewUrlPath: `/files/${f.id}/preview-url`,
    }))
  }

  /** AI 服务记录：本人 AiResumeResult(parse + optimize) 调用历史元数据（不含 payload）。 */
  async listAiRecords(endUserId: string): Promise<MemberAiRecordItem[]> {
    const rows = await this.prisma.aiResumeResult.findMany({
      where: { endUserId, expiresAt: { gt: new Date() } },
      select: { id: true, taskId: true, kind: true, status: true, provider: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      kind: r.kind === 'optimize' ? 'optimize' : 'parse',
      status: r.status,
      provider: r.provider,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    }))
  }
}
