import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Admin 处理告警：把状态改为 processing（处理中）/ resolved（已处理）/ ignored（已忽略）。
 *
 * 合规（CLAUDE.md §2/§8）：这只是**运营状态记录**，记录处理人/时间/备注，
 * **不直接远程控制设备**；真实设备动作仍由 Terminal Agent 本地执行。
 * 不允许改回 'new'（系统初始态）。
 */
export class UpdateAlertStatusDto {
  @IsIn(['processing', 'resolved', 'ignored'])
  status!: 'processing' | 'resolved' | 'ignored'

  /** 处理备注（可选，落 handleNote + 审计 payload）。 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
