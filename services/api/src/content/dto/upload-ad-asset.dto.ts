import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

/**
 * 上传素材时除 multipart file 外的表单字段。
 * multipart 字段到达时均为字符串,@Type(() => Number) 在 ValidationPipe transform 阶段转换。
 */
export class UploadAdAssetDto {
  @IsString()
  @MaxLength(80)
  title!: string

  /** 图片停留秒数 / 视频时长。缺省由服务端按类型给默认值。 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(1800)
  durationSec?: number
}
