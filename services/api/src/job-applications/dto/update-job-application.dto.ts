import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator'
import { JOB_APPLICATION_STATUSES, type JobApplicationStatus } from '../job-application.types'

/**
 * 更新求职进度入参。只允许改用户自己写的内容。
 *
 * 刻意**不允许**改 `jobId`：关联关系一旦建立就固定，否则用户可以把一条已派生快照
 * 的记录改挂到别的岗位上，快照与关联对不上。要换岗位就删了重记。
 *
 * 与 Create 同样受全局 forbidNonWhitelisted 保护：`channel` / `statusSource` /
 * `resumeFileId` / `consentId` 不在白名单内，传入即 400。
 */
export class UpdateJobApplicationDto {
  @IsOptional()
  @IsIn(JOB_APPLICATION_STATUSES, {
    message: 'status 必须是 intention / applied / interviewing / offered / rejected 之一',
  })
  status?: JobApplicationStatus

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  /** 显式传 null 表示清空；不传表示不改。 */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({}, { message: 'appliedAt 必须是 ISO8601 时间字符串或 null' })
  appliedAt?: string | null

  /** 仅对用户手填条目生效；已关联本站岗位的条目由服务端派生，改不动（service 层拒绝）。 */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  companyName?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  positionTitle?: string
}
