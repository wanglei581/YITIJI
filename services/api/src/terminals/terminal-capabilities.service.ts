// ============================================================
// TerminalCapabilitiesService — 打印扫描首期能力开关（Task 10 Step 3）
//
// 语义（对齐 packages/shared/types/printScanCapability.ts）：
//   - 每终端 × 能力键至多一行配置；未配置行 = 管理员未接管，Kiosk 按各自
//     保守默认处理（configured=false 明确下发，不伪装成已配置）。
//   - fail-closed：只有 status='available' 允许普通用户创建正式任务；
//     该判断由共享 canCreateFormalPrintScanTask 承担，本服务只管配置存取。
//   - 管理员写入的审计由 controller 负责（复用 AuditService 惯例）。
// ============================================================

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
  PRINT_SCAN_CAPABILITY_KEYS,
  PRINT_SCAN_CAPABILITY_STATUSES,
  canCreateFormalPrintScanTask,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
  type TerminalCapabilityView,
} from './terminal-capabilities.types'
import { PrismaService } from '../prisma/prisma.service'

export interface UpsertCapabilityResult {
  terminalCode: string
  capability: TerminalCapabilityView
  oldStatus: PrintScanCapabilityStatus | null
}

const MAX_NOTE_LENGTH = 200

@Injectable()
export class TerminalCapabilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin / Kiosk 共用：返回全部能力键，未配置的键 configured=false。 */
  async listForTerminal(terminalId: string): Promise<{ terminalCode: string; capabilities: TerminalCapabilityView[] }> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { terminalCode: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }

    const rows = await this.prisma.terminalCapability.findMany({ where: { terminalId } })
    const byKey = new Map(rows.map((row) => [row.capabilityKey, row]))

    const capabilities: TerminalCapabilityView[] = PRINT_SCAN_CAPABILITY_KEYS.map((key) => {
      const row = byKey.get(key)
      if (!row) {
        return { capabilityKey: key, status: 'not_verified', note: null, configured: false, updatedAt: null }
      }
      return {
        capabilityKey: key,
        status: this.asStatus(row.status),
        note: row.note,
        configured: true,
        updatedAt: row.updatedAt.toISOString(),
      }
    })

    return { terminalCode: terminal.terminalCode, capabilities }
  }

  async upsert(
    terminalId: string,
    capabilityKey: string,
    status: string,
    note: string | undefined,
    updatedBy: string,
  ): Promise<UpsertCapabilityResult> {
    if (!(PRINT_SCAN_CAPABILITY_KEYS as readonly string[]).includes(capabilityKey)) {
      throw new BadRequestException({ error: { code: 'CAPABILITY_KEY_INVALID', message: '未知的能力键' } })
    }
    if (!(PRINT_SCAN_CAPABILITY_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException({ error: { code: 'CAPABILITY_STATUS_INVALID', message: '未知的能力状态' } })
    }
    const trimmedNote = note?.trim() || null
    if (trimmedNote && trimmedNote.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException({ error: { code: 'CAPABILITY_NOTE_TOO_LONG', message: '备注过长' } })
    }

    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { terminalCode: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }

    const existing = await this.prisma.terminalCapability.findUnique({
      where: { terminalId_capabilityKey: { terminalId, capabilityKey } },
    })

    const row = await this.prisma.terminalCapability.upsert({
      where: { terminalId_capabilityKey: { terminalId, capabilityKey } },
      create: { terminalId, capabilityKey, status, note: trimmedNote, updatedBy },
      update: { status, note: trimmedNote, updatedBy },
    })

    return {
      terminalCode: terminal.terminalCode,
      oldStatus: existing ? this.asStatus(existing.status) : null,
      capability: {
        capabilityKey: capabilityKey as PrintScanCapabilityKey,
        status: this.asStatus(row.status),
        note: row.note,
        configured: true,
        updatedAt: row.updatedAt.toISOString(),
      },
    }
  }

  /**
   * 服务端能力门禁（最终真相源，Kiosk UI 只是体验层）：
   *   - 管理员配置过该终端该能力且状态非 available（含 DB 脏值归 not_verified）
   *     → 拒绝创建用户正式任务；
   *   - 未配置行的语义由 PRINT_SCAN_CAPABILITY_MODE 决定（Task 11 生产门禁要求
   *     生产必须显式声明，见 config/production-runtime-gates.ts）：
   *       managed（默认，兼容既有部署）= 管理员未接管 → 放行既有已验证闭环；
   *       strict = 未配置行 fail-closed 拒绝（全部能力必须显式验收后配置）。
   * 直达路由、绕过 Kiosk 的 API 调用同样被本门禁拦截。
   */
  async assertUserTaskAllowed(
    terminalId: string,
    capabilityKey: PrintScanCapabilityKey,
    mode: string | undefined = process.env['PRINT_SCAN_CAPABILITY_MODE'],
  ): Promise<void> {
    const row = await this.prisma.terminalCapability.findUnique({
      where: { terminalId_capabilityKey: { terminalId, capabilityKey } },
      select: { status: true, note: true },
    })
    if (!row) {
      if (mode?.trim().toLowerCase() === 'strict') {
        throw new ForbiddenException({
          error: {
            code: 'CAPABILITY_NOT_CONFIGURED',
            message: '该终端此服务尚未完成验收配置，请咨询现场工作人员',
          },
        })
      }
      return
    }
    const status = this.asStatus(row.status)
    if (canCreateFormalPrintScanTask(status)) return
    throw new ForbiddenException({
      error: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: row.note ? `该终端当前不提供此服务：${row.note}` : '该终端当前不提供此服务，请咨询现场工作人员',
      },
    })
  }

  /** DB 中出现枚举外的脏值时按 fail-closed 归入 not_verified，不放大成可用。 */
  private asStatus(raw: string): PrintScanCapabilityStatus {
    return (PRINT_SCAN_CAPABILITY_STATUSES as readonly string[]).includes(raw)
      ? (raw as PrintScanCapabilityStatus)
      : 'not_verified'
  }
}
