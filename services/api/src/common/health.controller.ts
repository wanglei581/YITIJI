import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { bootReadiness, type BootSubsystemState } from './boot/boot-readiness'

/**
 * 健康检查。上线清单 §3.8 探活用，遵守 CLAUDE.md §9「不伪造能力」：
 * - 真实执行一次数据库查询（不是只回 ok 的假探活）；
 * - 返回 dbKind，便于部署验收确认生产连接的是 PostgreSQL 而非 SQLite；
 * - **如实暴露启动期降级的子系统**（例如 Redis 不可达 → 会员会话/验证码/频控
 *   与隐私清理调度不可用）。笼统回一个 ok 就是伪造能力。
 * - 不输出任何配置值/密钥。
 *
 * 两个端点职责分开，不要合并：
 * - `GET /health` = liveness。数据库不可用才 503。Redis 降级仍回 200，
 *   但 `data.status` 为 `degraded` 且 `data.degraded[]` 列出事实。
 *   Kiosk 的 `ErrorOfflinePage` / `useApiReadiness` 只看 HTTP 状态码，
 *   Redis 降级时把一体机整机判成「断网」会掩盖真实故障，也阻断打印链路。
 * - `GET /health/ready` = readiness。任一子系统降级即 503，
 *   供负载均衡 / 部署验收 / 只看状态码的运维脚本使用。
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    await this.assertDatabase()
    const degraded = bootReadiness.degraded()
    return {
      success: true,
      data: {
        status: degraded.length > 0 ? 'degraded' : 'ok',
        db: this.prisma.dbKind,
        degraded: degraded.map(toPublicState),
        time: new Date().toISOString(),
      },
    }
  }

  @Get('ready')
  async ready() {
    await this.assertDatabase()
    const degraded = bootReadiness.degraded()
    if (degraded.length > 0) {
      // details 必须是字符串数组：HttpExceptionFilter 只透传 string 元素，
      // 传对象会被过滤成空数组 —— 那就成了「说有问题却说不出是什么」。
      // 结构化明细在 GET /health（200，不经过过滤器）里完整给出。
      throw new ServiceUnavailableException({
        error: {
          code: 'HEALTH_DEPENDENCY_DEGRADED',
          message: `以下子系统处于降级状态：${degraded.map((s) => s.subsystem).join(', ')}`,
          details: degraded.map((s) => `${s.subsystem}: ${s.code} — ${s.message}`),
        },
      })
    }
    return {
      success: true,
      data: {
        status: 'ready',
        db: this.prisma.dbKind,
        subsystems: bootReadiness.snapshot().map(toPublicState),
        time: new Date().toISOString(),
      },
    }
  }

  private async assertDatabase(): Promise<void> {
    try {
      // 真实 DB 往返(任意轻量 count),不是只回 ok 的假探活
      await this.prisma.user.count()
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'HEALTH_DB_UNAVAILABLE', message: '数据库连接不可用' },
      })
    }
  }
}

/**
 * 只暴露运维需要的字段；message 由服务端构造，不含凭证或用户数据。
 *
 * `impact` 是 message 的机器可读版本：门禁按它逐个面实际发请求核对，
 * 保证这里说的话与系统真实行为一致（历史事故：曾宣称「管理端不受影响」而管理端全线 500）。
 */
function toPublicState(state: BootSubsystemState) {
  return {
    subsystem: state.subsystem,
    status: state.status,
    code: state.code,
    message: state.message,
    ...(state.impact ? { impact: state.impact } : {}),
    since: state.since,
  }
}
