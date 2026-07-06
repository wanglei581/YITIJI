import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class CreateTerminalBindCodeDto {
  /** 绑定码有效分钟数。默认 10 分钟，最多 60 分钟。 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  ttlMinutes?: number
}
