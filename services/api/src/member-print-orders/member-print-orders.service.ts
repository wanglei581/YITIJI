import { Injectable } from '@nestjs/common'
import type { MemberPrintOrderItem } from './member-print-orders.types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'

// ============================================================
// 会员「我的打印订单」服务（Phase C-2C 后续小步，只读）。
//
// 唯一过滤维度是传入的 endUserId（来自 EndUserAuthGuard 注入的 req.endUser）：
// 只返回**本人**的打印任务。匿名 / 跨用户在 controller 层（guard）就已拒绝；
// service 永远拿到已认证的 endUserId，绝不接受任意 id 参数 → 天然杜绝越权。
//
// 合规（CLAUDE.md §10/§11/§12）：
// - 只回安全元数据。绝不返回 fileUrl(签名链接) / fileMd5(SHA-256) / paramsJson 原文 /
//   errorCode / errorMessage(可能含内部细节) 等敏感字段。
// - 不返回 pages / deviceName / amount / paidStatus —— 这些列在 PrintTask 中**不存在**，
//   不编造、不接支付逻辑。
// - 空列表返回 []，不伪造订单数量。
// ============================================================

type ParsedParams = {
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
}

const EMPTY_PARAMS: ParsedParams = { fileName: null, copies: null, colorMode: null, paperSize: null }

/**
 * 从 PrintTask.paramsJson（写入时由强校验 DTO 产生，但读时仍按不可信处理）安全提取
 * 白名单元数据。任何缺失 / 类型不符 / JSON 损坏 → 该字段返回 null，绝不抛错、绝不透传未知字段。
 */
function parseSafeParams(paramsJson: string): ParsedParams {
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return EMPTY_PARAMS
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY_PARAMS
  const p = raw as Record<string, unknown>

  const fileName = typeof p['fileName'] === 'string' && p['fileName'].length > 0 ? p['fileName'] : null
  const copies =
    typeof p['copies'] === 'number' && Number.isInteger(p['copies']) && p['copies'] >= 1 && p['copies'] <= 99
      ? p['copies']
      : null
  const colorMode =
    p['colorMode'] === 'black_white' || p['colorMode'] === 'color' ? p['colorMode'] : null
  const paperSize = typeof p['paperSize'] === 'string' && p['paperSize'].length > 0 ? p['paperSize'] : null

  return { fileName, copies, colorMode, paperSize }
}

@Injectable()
export class MemberPrintOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的打印订单（本人），游标分页（C-2D，不做无界查询）。无任何订单返回空 items。 */
  async list(
    endUserId: string,
    page: MemberPageQuery,
  ): Promise<{ items: MemberPrintOrderItem[]; nextCursor: string | null; total: number }> {
    const where = { endUserId }
    const total = await this.prisma.printTask.count({ where })
    // select 显式收口：只取安全列，连 fileUrl / fileMd5 都不从 DB 读出，杜绝误透传。
    const rows = await this.prisma.printTask.findMany({
      where,
      select: { id: true, status: true, paramsJson: true, createdAt: true, completedAt: true },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r) => {
      const params = parseSafeParams(r.paramsJson)
      return {
        id: r.id,
        status: r.status,
        fileName: params.fileName,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        copies: params.copies,
        colorMode: params.colorMode,
        paperSize: params.paperSize,
      }
    })
  }
}
