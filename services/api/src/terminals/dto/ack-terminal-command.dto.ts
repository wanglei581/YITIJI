import { Allow, IsOptional, IsString } from 'class-validator'

/**
 * 结果是否合法取决于命令类型，在服务里校验，这里不写 @IsIn。
 * 清空队列的 done / failed 若被全局校验管线拦住，就到不了 TERMINAL_COMMAND_ACK_INVALID。
 * remainingJobs 原样交给服务：失败必须是非负整数，完成只能不带或为 0。
 */
export class AckTerminalCommandDto {
  @IsString()
  result!: string

  @Allow()
  @IsOptional()
  remainingJobs?: unknown
}
