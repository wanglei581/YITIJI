import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { FavoriteTargetType } from '../member-favorites.types'

/** 收藏对象类型白名单（与 shared FavoriteTargetType 对齐）。 */
export const FAVORITE_TARGET_TYPES: FavoriteTargetType[] = ['job', 'job_fair', 'policy']

/**
 * 新增收藏入参。ValidationPipe(whitelist) 自动剥除未知字段，
 * 杜绝把任何投递 / 候选人 / 简历相关字段注入收藏记录。
 */
export class AddFavoriteDto {
  @IsIn(FAVORITE_TARGET_TYPES, { message: 'targetType 必须是 job / job_fair / policy 之一' })
  targetType!: FavoriteTargetType

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  targetId!: string

  /** 展示标题快照（可空，仅展示用，不含 PII / 投递信息）。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string
}
