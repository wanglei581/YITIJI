import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { JOB_APPLICATION_STATUSES, type JobApplicationStatus } from '../job-application.types'

/**
 * 新建求职进度入参。
 *
 * 全局 ValidationPipe 已开 whitelist + forbidNonWhitelisted，**任何未声明的字段直接 400**。
 * 这正是合规防线的一部分：`channel`、`statusSource`、`resumeFileId`、`consentId`
 * 刻意不出现在本 DTO 里，因此前端根本无法传入 —— 渠道与状态来源由服务端恒定写入，
 * 简历与同意槽位在无证期没有任何写入路径（compliance-boundary.md §4.4A）。
 *
 * 同理不接受 `companyProfileId`、`employerId`、`recruiterId` 等任何指向企业侧的字段。
 */
export class CreateJobApplicationDto {
  /** 关联本站岗位。传了就由服务端从「已审核已发布」岗位派生展示快照，前端给的快照一律忽略。 */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  jobId?: string

  /** jobId 为空时必填（用户自述的站外岗位）。service 层做「二选一」校验。 */
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

  @IsOptional()
  @IsIn(JOB_APPLICATION_STATUSES, {
    message: 'status 必须是 intention / applied / interviewing / offered / rejected 之一',
  })
  status?: JobApplicationStatus

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  /** 用户自述的投递时间，不是系统观测到的事实。 */
  @IsOptional()
  @IsISO8601({}, { message: 'appliedAt 必须是 ISO8601 时间字符串' })
  appliedAt?: string
}
