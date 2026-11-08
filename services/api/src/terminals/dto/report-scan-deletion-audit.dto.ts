import { IsISO8601, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { SCAN_DELETION_REASON_CODES, type ScanDeletionReasonCode } from '../scan-deletion-reason-codes'

const HEX_HMAC = /^[a-f0-9]{64}$/
const MACHINE_ERROR_CODE = /^[A-Z0-9_-]{1,64}$/

export class ReportScanDeletionAuditDto {
  @Matches(HEX_HMAC)
  eventId!: string

  /** 面板扫描、屏上扫描与屏上复印的删除原因，取值表见 scan-deletion-reason-codes.ts。 */
  @IsIn(SCAN_DELETION_REASON_CODES)
  reasonCode!: ScanDeletionReasonCode

  @Matches(HEX_HMAC)
  identifierHash!: string

  @IsISO8601({ strict: true })
  createdAt!: string

  @IsOptional()
  @IsISO8601({ strict: true })
  deletedAt?: string | null

  @IsIn(['pending_delete', 'deleted', 'delete_failed'])
  result!: 'pending_delete' | 'deleted' | 'delete_failed'

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  deleteAttempts!: number

  @IsISO8601({ strict: true })
  lastDeleteAttemptAt!: string

  @IsOptional()
  @Matches(MACHINE_ERROR_CODE)
  lastErrorCode?: string | null
}
