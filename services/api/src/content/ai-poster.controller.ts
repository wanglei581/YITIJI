import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AiPosterService } from './ai-poster.service'
import { GenerateAiPosterDto } from './dto/generate-ai-poster.dto'

/**
 * AI 文生图海报接口(二期能力,一期 stub,全部 admin-only)。
 *
 * 一期 AI_IMAGE_PROVIDER=disabled:
 *   - GET  /admin/ai-posters/status          返回 { enabled:false, ... },供后台展示"暂未启用"
 *   - 其余生成/查询/确认接口一律返回 400 AI_POSTER_NOT_ENABLED,不假装成功
 */
@Controller('admin/ai-posters')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AiPosterController {
  constructor(private readonly aiPoster: AiPosterService) {}

  @Get('status')
  status() {
    return this.aiPoster.status()
  }

  @Post('generations')
  generate(@Body() dto: GenerateAiPosterDto) {
    return this.aiPoster.generate({ prompt: dto.prompt, size: dto.size })
  }

  @Get('generations/:id')
  async get(@Param('id') id: string) {
    const result = await this.aiPoster.get(id)
    if (!result) {
      throw new NotFoundException({ error: { code: 'AI_POSTER_GENERATION_NOT_FOUND', message: '生成记录不存在' } })
    }
    return result
  }

  @Post('generations/:id/accept')
  accept(@Param('id') id: string) {
    return this.aiPoster.accept(id)
  }
}
