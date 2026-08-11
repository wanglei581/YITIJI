import { IsISO8601, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'

const HEX_HMAC = /^[a-f0-9]{64}$/
const MACHINE_ERROR_CODE = /^[A-Z0-9_-]{1,64}$/

export class ReportScanDeletionAuditDto {
  @Matches(HEX_HMAC)
  eventId!: string

  @IsIn(['UNCLAIMED_TTL_EXPIRED'])
  reasonCode!: 'UNCLAIMED_TTL_EXPIRED'

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
