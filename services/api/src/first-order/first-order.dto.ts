import { BadRequestException } from '@nestjs/common'
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'
import type { FirstOrderIncidentStatus } from '../../../../packages/shared/src/types/firstOrder.contract'

/** Default 100. Values above 200 are clamped; they are not an error. */
export function parseFirstOrderListLimit(raw?: string): number {
  if (raw === undefined) return 100
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException({ error: { code: 'FIRST_ORDER_LIMIT_INVALID', message: '请填写有效的条数' } })
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) return 200
  return Math.min(value, 200)
}

export class AdminIncidentDirectoryQuery {
  @IsOptional()
  @IsIn(['open', 'processing', 'resolved', 'closed'], { message: '请选择有效的工单状态' })
  status?: FirstOrderIncidentStatus

  @IsOptional()
  @Matches(/^[1-9]\d*$/, { message: '请填写有效的条数' })
  limit?: string
}

export class AdminReportDirectoryQuery {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '请选择有效月份' })
  month?: string

  @IsOptional()
  @Matches(/^[1-9]\d*$/, { message: '请填写有效的条数' })
  limit?: string
}

export class AdminFirstOrderQuery {
  @IsString() @IsNotEmpty() @MaxLength(100) orgId!: string
}
export class FirstOrderProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string
  @IsString() @IsNotEmpty() @MaxLength(100) reference!: string
  @IsDateString() serviceStartAt!: string
  @IsDateString() serviceEndAt!: string
  @IsString() @IsNotEmpty() @MaxLength(1000) serviceScope!: string
  @IsString() @IsNotEmpty() @MaxLength(200) supportContact!: string
}
export class CreateFirstOrderProjectDto extends FirstOrderProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(100) orgId!: string
}
export class UpdateFirstOrderProjectDto extends FirstOrderProjectDto {
  @IsInt() @Min(1) version!: number
}
export class FirstOrderDeploymentDto {
  @IsString() @IsNotEmpty() @MaxLength(100) terminalId!: string
  @IsString() @IsNotEmpty() @MaxLength(200) locationLabel!: string
}
export class FirstOrderMonthDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string
}
/** Deliberately rejects orgId and arbitrary client-supplied identity fields. */
export class FirstOrderEmptyDto {
  @IsOptional() @IsString() @MaxLength(0) _unused?: string
}
