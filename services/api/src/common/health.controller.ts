import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 健康检查（GET /api/v1/health）。上线清单 §3.8 探活用：
 * - 真实执行一次数据库查询（不是只回 ok 的假探活）；
 * - 返回 dbKind，便于部署验收确认生产连接的是 PostgreSQL 而非 SQLite；
 * - 不输出任何配置值/密钥。数据库不可用时如实返回 503。
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    try {
      // 真实 DB 往返(任意轻量 count),不是只回 ok 的假探活
      await this.prisma.user.count()
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'HEALTH_DB_UNAVAILABLE', message: '数据库连接不可用' },
      })
    }
    return {
      success: true,
      data: { status: 'ok', db: this.prisma.dbKind, time: new Date().toISOString() },
    }
  }
}
