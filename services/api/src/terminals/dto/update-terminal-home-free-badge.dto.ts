import { IsBoolean } from 'class-validator'

/** 必须是布尔。字符串和数字不转换，避免把 "true" / 1 当成开。 */
export class UpdateTerminalHomeFreeBadgeDto {
  @IsBoolean()
  enabled!: boolean
}
