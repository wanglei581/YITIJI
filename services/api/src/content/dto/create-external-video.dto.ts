import { Type } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

/**
 * 登记外部视频直链素材的 JSON 入参。
 *
 * 这里只做基础形态校验;HTTPS / 私网 / mp4-webm / 白名单等安全校验
 * 在 ContentService.createExternalAsset → validateExternalVideoUrl 中完成,
 * 不合法返回 400。
 */
export class CreateExternalVideoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url!: string

  @IsString()
  @MaxLength(80)
  title!: string

  /** 视频时长(秒)。缺省由服务端给默认值。 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(1800)
  durationSec?: number
}
