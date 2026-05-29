import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * 契约源:`packages/shared/src/types/admin.ts` 的 ReviewAction / ReviewActionPayload。
 * services/api 是 CommonJS,shared 是 ESM,运行时不可互通,故此处保留
 * 本地副本。两边任一改动必须同步,代码评审兜底。
 */
export type ReviewAction = 'reviewing' | 'approve' | 'reject'

export class ReviewActionDto {
  @IsIn(['reviewing', 'approve', 'reject'])
  action!: ReviewAction

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
