import { IsIn } from 'class-validator'

/**
 * 契约源:`packages/shared/src/types/admin.ts` 的 PublishAction / PublishActionPayload。
 * services/api 是 CommonJS,shared 是 ESM,运行时不可互通,故此处保留本地副本。
 */
export type PublishAction = 'publish' | 'unpublish'

export class PublishActionDto {
  @IsIn(['publish', 'unpublish'])
  action!: PublishAction
}
