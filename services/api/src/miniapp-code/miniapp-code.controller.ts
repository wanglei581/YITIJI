import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { MiniappCodeService } from './miniapp-code.service'

/**
 * 一体机取小程序码。
 *
 * 不做成 GET + 查询串，是因为 scene 里会带上传会话标识；GET 会进 nginx / 浏览器历史，
 * 而这类标识属于一次性凭据的一部分。POST + 不缓存是更保守的一侧。
 */
class MiniappCodeRequestDto {
  /** 目标页面路径，必须是小程序里真实存在的页（微信会 check_path）。 */
  @IsString()
  @MaxLength(128)
  @Matches(/^pages\/[A-Za-z0-9/_-]+$/, { message: 'page 必须是 pages/ 开头的小程序页面路径' })
  page!: string

  /** 透传给小程序的参数，微信限制 32 个可见字符。 */
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9!#$&'()*+,/:;=?@\-._~%]{1,32}$/, { message: 'scene 含微信不允许的字符' })
  scene!: string

  @IsOptional()
  @IsIn(['png-base64'])
  format?: 'png-base64'
}

@Controller('miniapp')
export class MiniappCodeController {
  constructor(private readonly service: MiniappCodeService) {}

  /** 能力探测：一体机据此决定显示小程序码还是显示诚实的「未开放」。 */
  @Post('code/capabilities')
  @HttpCode(HttpStatus.OK)
  capabilities(): { data: { available: boolean; envVersion: string } } {
    return { data: { available: this.service.isConfigured(), envVersion: this.service.envVersion() } }
  }

  // 一体机是单机低频调用；20 次/分钟足够正常使用，又能挡住循环打微信配额的情况。
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('code')
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: MiniappCodeRequestDto): Promise<{
    data: { imageBase64: string; mimeType: string; dataUri: string; envVersion: string }
  }> {
    const result = await this.service.generate(dto.page, dto.scene)
    const imageBase64 = result.image.toString('base64')
    // 一并给出 dataUri，调用方不必自己拼 MIME —— 写死 image/png 正是本次踩过的坑。
    return {
      data: {
        imageBase64,
        mimeType: result.mimeType,
        dataUri: `data:${result.mimeType};base64,${imageBase64}`,
        envVersion: result.envVersion,
      },
    }
  }
}
