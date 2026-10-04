import { BadRequestException, ConflictException } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import { materialCheckRequired, PII_SCAN_REQUIRED_PURPOSES } from './material-check-policy'

// 原导出名保留：scripts/support/ai-artifact-print-pii-gate.ts 等从这里取。
export { PII_SCAN_REQUIRED_PURPOSES }

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u

/** 与 materials-manual-confirmation.service.ts 的 PII_MANUAL_CONFIRMABLE_MODES 同一份口径（门禁比对两处一致）。 */
export const PII_SCAN_INCOMPLETE_MODES = new Set(['partial', 'degraded', 'unsupported_format'])

/**
 * A-04：隐私检查没有完整覆盖的原件，建单前要求本人确认（任务 result.manualConfirmedAt）。
 * 默认关——小程序会员订单、材料包、到机码建单也走这道闸，而目前只有一体机会做确认步骤；
 * 一体机材料检查页接好「我已确认，继续打印」后与 AI_DECLARATION_ENFORCEMENT 同批打开。
 */
export function piiManualConfirmEnforced(): boolean {
  const raw = process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']?.trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'on'
}

type PiiGateArgs = {
  prisma: PrismaService
  audit?: AuditService
  fileId: string
  requireCompleted: boolean
  actorRole?: string
  missingMessage: string
  pendingMessage: string
  pendingCode?: string
}

/**
 * Shared print PII gate. A completed scan is bound to the exact server SHA-256
 * captured in DocumentProcessTask.paramsJson; a missing SHA is deliberately
 * stale, including direct COS uploads above the server sniffing threshold.
 *
 * 哪些文件要查只看 materialCheckRequired()（与「我的文档」列表同一个函数）：
 * 转换件、签名件与原件一样按本件 sha256 要一条完成的隐私检查，不完整时走同一条本人确认。
 */
export async function assertPiiScanned(args: PiiGateArgs): Promise<void> {
  const file = await args.prisma.fileObject.findUnique({
    where: { id: args.fileId },
    select: { purpose: true, assetCategory: true, derivationKind: true, sha256: true },
  })
  if (!file) return
  if (!materialCheckRequired(file)) return

  // 以最晚的一条完成检查为准（重扫可能查出更多内容，旧结论不继承）；
  // 但同一次进页面可能并发建出两条一模一样的检查（W-118：间隔 0–23 毫秒），用户只裁决了其中一条。
  // 这种「孪生」检查——同一内容、同一结果、创建时间挨着——裁决过任意一条即视为已裁决。
  const scans = await args.prisma.documentProcessTask.findMany({
    where: { sourceFileId: args.fileId, kind: 'pii_scan', status: 'completed' },
    orderBy: { createdAt: 'desc' },
    take: PII_SCAN_TWIN_LOOKBACK,
    select: {
      id: true, paramsJson: true, resultJson: true, createdAt: true,
      findings: { select: { type: true, label: true, pageNumber: true, snippet: true, action: true } },
    },
  })
  const latest = scans[0]
  const twins = latest ? scans.filter((scan) => scan === latest || isTwinScan(latest, scan)) : []
  const pendingOf = (scan: PiiScanRow) => scan.findings.filter((finding) => finding.action === 'pending').length
  const decided = twins.filter((scan) => pendingOf(scan) === 0)
  const scan = decided[0] ?? latest
  const pendingFindings = scan ? pendingOf(scan) : 0

  if (scan && pendingFindings === 0) {
    const scanSha = readPiiScanSourceSha256(scan.paramsJson)
    if (!SHA256_HEX_PATTERN.test(file.sha256) || file.sha256 !== scanSha) {
      throw new ConflictException({
        error: {
          code: 'PII_SCAN_STALE',
          message: '文件在隐私检查后又被改过，请重新检查后再打印',
          nextAction: PII_GATE_NEXT_ACTION,
        },
      })
    }
    if (args.requireCompleted && piiManualConfirmEnforced()) {
      const confirmed = decided.some((item) => {
        const result = readJsonObject(item.resultJson)
        return !PII_SCAN_INCOMPLETE_MODES.has(String(result['mode'] ?? '')) || typeof result['manualConfirmedAt'] === 'string'
      })
      if (!confirmed) {
        throw new BadRequestException({
          error: {
            code: 'PRINT_PII_MANUAL_CONFIRM_REQUIRED',
            message: '隐私检查没有完整覆盖这份文件，请先确认文件里没有不想打印的个人信息',
            nextAction: PII_GATE_NEXT_ACTION,
          },
        })
      }
    }
    return
  }

  if (!args.requireCompleted) {
    await args.audit?.write({
      actorId: null,
      actorRole: args.actorRole ?? 'kiosk',
      action: 'print_job.pii_scan_bypassed',
      targetType: 'file_object',
      targetId: args.fileId,
      payload: {
        reason: !scan ? 'PII_SCAN_MISSING' : 'PII_DECISIONS_PENDING',
        purpose: file.purpose,
        assetCategory: file.assetCategory,
        derivationKind: file.derivationKind,
        pendingFindings,
      },
    })
    return
  }

  throw new BadRequestException({
    error: {
      code: scan && pendingFindings > 0 ? (args.pendingCode ?? 'PRINT_PII_SCAN_REQUIRED') : 'PRINT_PII_SCAN_REQUIRED',
      message: scan && pendingFindings > 0 ? args.pendingMessage : args.missingMessage,
      // 页面凭这个标识把用户带回材料检查页；被拒后原地重试救不回来。
      nextAction: PII_GATE_NEXT_ACTION,
    },
  })
}

/** 被隐私闸门拒绝时给页面的下一步：回材料检查页把检查 / 裁决做完。 */
export const PII_GATE_NEXT_ACTION = 'return_to_material_check'
/** 孪生检查的创建时间最多相差这么久；超过就是用户后来的重扫，旧结论不继承。 */
export const PII_SCAN_TWIN_WINDOW_MS = 3_000
const PII_SCAN_TWIN_LOOKBACK = 10

type PiiScanRow = {
  id: string
  paramsJson: string
  resultJson: string | null
  createdAt: Date
  findings: Array<{ type: string; label: string; pageNumber: number | null; snippet: string | null; action: string }>
}

function findingSignature(scan: PiiScanRow): string {
  return scan.findings.map((f) => `${f.type}|${f.label}|${f.pageNumber ?? ''}|${f.snippet ?? ''}`).sort().join('\n')
}

/** 同一内容（sha）、同一覆盖程度（mode）、同一组命中、创建时间挨着，才算同一次检查的两份。 */
function isTwinScan(a: PiiScanRow, b: PiiScanRow): boolean {
  if (Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) > PII_SCAN_TWIN_WINDOW_MS) return false
  const sha = readPiiScanSourceSha256(a.paramsJson)
  if (!sha || sha !== readPiiScanSourceSha256(b.paramsJson)) return false
  if (String(readJsonObject(a.resultJson)['mode'] ?? '') !== String(readJsonObject(b.resultJson)['mode'] ?? '')) return false
  return findingSignature(a) === findingSignature(b)
}

function readJsonObject(json: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json || '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readPiiScanSourceSha256(paramsJson: string | null): string {
  try {
    const parsed = JSON.parse(paramsJson || '{}') as { sourceSha256?: unknown }
    return typeof parsed.sourceSha256 === 'string' ? parsed.sourceSha256 : ''
  } catch {
    return ''
  }
}
