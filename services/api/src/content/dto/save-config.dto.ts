import { IsBoolean, IsInt, IsString, Max, Min, ValidateIf } from 'class-validator'

export class SaveScreensaverConfigDto {
  @IsBoolean()
  enabled!: boolean

  @IsInt()
  @Min(30)
  @Max(1800)
  idleTimeoutSec!: number

  /** 绑定的播放方案 id;传 null 解绑(解绑后 enabled 会被服务端强制为 false)。 */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  playlistId!: string | null
}
