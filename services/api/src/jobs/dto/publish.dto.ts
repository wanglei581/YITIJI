import { IsIn } from 'class-validator'

export type PublishAction = 'publish' | 'unpublish'

export class PublishActionDto {
  @IsIn(['publish', 'unpublish'])
  action!: PublishAction
}
