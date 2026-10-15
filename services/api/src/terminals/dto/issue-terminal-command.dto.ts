import { Allow, IsOptional } from 'class-validator'

/**
 * 下发体只接受 type。不用 @IsIn：非法类型要落到 TERMINAL_COMMAND_TYPE_INVALID，
 * 而不是全局校验管线的 VALIDATION_FAILED。多出来的字段仍会被白名单拒绝。
 */
export class IssueTerminalCommandDto {
  @Allow()
  @IsOptional()
  type?: unknown
}
