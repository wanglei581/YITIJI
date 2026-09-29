import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator'
import {
  KIOSK_SERVICE_CATEGORIES,
  KIOSK_SESSION_END_REASONS,
  type KioskServiceCategory,
  type KioskSessionEndReason,
} from '../kiosk-session.types'

export class StartKioskSessionDto {
  @IsUUID('4')
  clientSessionId!: string

  /** 本周期开始时间（唤醒或上一次清场） */
  @IsISO8601({ strict: true })
  wokeAt!: string

  /** 第一次有效操作所属大类 */
  @IsIn(KIOSK_SERVICE_CATEGORIES)
  category!: KioskServiceCategory
}

export class TouchKioskSessionDto {
  @IsUUID('4')
  clientSessionId!: string

  @IsOptional()
  @IsIn(KIOSK_SERVICE_CATEGORIES)
  category?: KioskServiceCategory
}

export class EndKioskSessionDto {
  @IsUUID('4')
  clientSessionId!: string

  @IsISO8601({ strict: true })
  endedAt!: string

  @IsIn(KIOSK_SESSION_END_REASONS)
  endReason!: KioskSessionEndReason
}
