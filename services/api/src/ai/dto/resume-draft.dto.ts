import { Type } from 'class-transformer'
import { IsObject, IsOptional, ValidateNested } from 'class-validator'
import { ResumeLayoutAdjustResumeDto, ResumeLayoutDto } from './resume-generate.dto'

/** PUT /resume/records/:taskId/draft — 登录用户编辑稿。 */
export class ResumeDraftPutDto {
  @IsObject() @ValidateNested() @Type(() => ResumeLayoutAdjustResumeDto)
  resume!: ResumeLayoutAdjustResumeDto

  @IsOptional() @IsObject() @ValidateNested() @Type(() => ResumeLayoutDto)
  layout?: ResumeLayoutDto

  /** 用户对优化条目的采纳 / 保留裁决。服务端原样落库，不解释语义。 */
  @IsOptional() @IsObject()
  decisions?: Record<string, unknown>
}
