import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../prisma/prisma.module'
import { ContentController } from './content.controller'
import { AiPosterController } from './ai-poster.controller'
import { ContentService } from './content.service'
import { AiPosterService } from './ai-poster.service'

/**
 * 待机宣传屏内容模块。
 *
 * 提供:
 *   - 管理员:素材上传/管理、播放方案 CRUD、终端配置
 *   - Kiosk:拉取屏保配置 + 播放列表(无登录,只读)
 *   - 素材内容:HMAC 签名 URL 流式返回
 *   - AI 文生图:二期能力 stub(默认 disabled)
 *
 * 依赖:
 *   - PrismaModule:落库 AdAsset / AdPlaylist / AdPlaylistItem / TerminalScreensaverConfig
 *   - JwtModule:JwtAuthGuard 验签
 *   - AuditService(@Global):管理员写操作审计,由 controller 回写
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({ secret: process.env['JWT_SECRET'] ?? 'dev-only-secret' }),
  ],
  controllers: [ContentController, AiPosterController],
  providers: [ContentService, AiPosterService],
  exports: [ContentService],
})
export class ContentModule {}
