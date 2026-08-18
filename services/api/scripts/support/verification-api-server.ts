/**
 * 在**当前进程内**拉起真实 AppModule 的 HTTP 服务,供端到端验证脚本使用。
 *
 * 与 `scripts/support/boot-api-child.ts`(拉子进程验证启动韧性)的分工不同:
 * 这里要的是「真实控制器 + 真实 Guard + 真实 ValidationPipe + 真实 Prisma」,
 * 好让验证脚本发出的请求与运营在后台点按钮时**走同一条代码路径**。
 *
 * 装配严格镜像 `src/main.ts`:
 *   bodyParser:false → installBodyParsers(保 rawBody,webhook 验签依赖它)
 *   → setGlobalPrefix('api/v1') → ValidationPipe(whitelist + forbidNonWhitelisted
 *   + 同一个 exceptionFactory) → HttpExceptionFilter
 * 少任何一环,验证出来的行为就不是生产行为(例如漏掉 rawBody 会让 webhook 恒 401,
 * 漏掉 forbidNonWhitelisted 会让「注入候选人字段必须 400」这条合规断言恒绿)。
 */
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import { installBodyParsers } from '../../src/config/body-parsers'

/** 与 src/main.ts 的 flattenValidationErrors 同形(错误信息形状必须一致)。 */
function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property
    if (e.constraints) for (const msg of Object.values(e.constraints)) out.push(`${path}: ${msg}`)
    if (e.children && e.children.length) {
      const childPath = Array.isArray(e.target) ? `${parent}[${e.property}]` : path
      out.push(...flattenValidationErrors(e.children, childPath))
    }
  }
  return out
}

export interface VerificationApiServer {
  /** `http://127.0.0.1:<port>/api/v1` */
  base: string
  app: INestApplication
  close(): Promise<void>
}

/**
 * `redisUrl` 的装配顺序是刻意的,不是随手写的:
 *
 *   BullMQ 相关模块(job-sync / member-privacy / contract-review)在**模块加载期**
 *   读 `process.env.REDIS_URL` 决定「注册队列」还是「走 inline 回退」;
 *   而 `RedisModule` 的 `REDIS_CLIENT` 工厂是在**依赖注入实例化期**才读同一个变量。
 *
 * 于是「先摘掉 REDIS_URL 再 import AppModule,import 完再塞回去」这一手,
 * 让队列模块选 inline 回退(本验证要的正是 inline 路径,与 verify-job-sync.ts 同口径),
 * 同时 RedisModule 仍拿得到连接 —— webhook 的 nonce 防重放需要它。
 *
 * 不这么做的话:队列会连上不实现 Lua 的内存桩,每几秒吐一整屏 BullMQ 脚本源码,
 * 真正的验证输出会被噪声淹没(实测第一版就是这样)。
 */
export async function startVerificationApi(port: number, redisUrl?: string): Promise<VerificationApiServer> {
  const savedRedisUrl = redisUrl ?? process.env['REDIS_URL']
  delete process.env['REDIS_URL']
  const { AppModule } = await import('../../src/app.module')
  if (savedRedisUrl) process.env['REDIS_URL'] = savedRedisUrl
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  })
  installBodyParsers(app)
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = flattenValidationErrors(errors)
        const message = details.length > 0 ? details[0]! : '请求参数校验失败'
        return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message, details } })
      },
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(port, '127.0.0.1')
  return {
    base: `http://127.0.0.1:${port}/api/v1`,
    app,
    async close() {
      await app.close()
    },
  }
}
