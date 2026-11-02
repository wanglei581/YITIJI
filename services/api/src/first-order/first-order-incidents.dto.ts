import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator'
import type { FirstOrderIncidentAction, FirstOrderIssue } from '../../../../packages/shared/src/types/firstOrder.contract'

export class CreateIncidentDto {
  @IsString() @IsNotEmpty() @MaxLength(100) deploymentId!: string
  @IsIn(['offline', 'paper', 'jam', 'quality', 'scan', 'other']) issueCode!: FirstOrderIssue
  @IsString() @MaxLength(300) note!: string
  @IsUUID() requestKey!: string
}
export class UpdateIncidentDto {
  @IsIn(['start', 'resolve', 'confirm', 'reopen']) action!: FirstOrderIncidentAction
  @IsInt() @Min(1) version!: number
  @IsString() @MaxLength(300) note!: string
  @IsOptional() @IsString() @MaxLength(80) assignee?: string
}
