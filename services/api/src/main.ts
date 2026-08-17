import 'reflect-metadata'
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { bootReadiness } from './common/boot/boot-readiness'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { installBodyParsers } from './config/body-parsers'
import { assertProductionRuntimeGates } from './config/production-runtime-gates'
import { resolveTrustProxyHops } from './config/trust-proxy'
import { requirePaidBeforeClaim } from './terminals/terminal-utils'

// rawBody 捕获与 body parser 装配已抽到 config/body-parsers.ts（与 verify 脚本共用，
// 防真实入口与测试口径漂移 —— C5-6 双模型审查修复的守护点）。

/**
 * 把 class-validator 的嵌套 ValidationError[] 扁平为路径化字符串数组。
 *
 *   items[0].externalId: should not be empty
 *   sourceUrl: must be a string
 *
 * 用于 ValidationPipe 的 exceptionFactory,让 400 的响应里
 * 客户端能直接看到具体哪个字段挂了。
 */
function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property
    if (e.constraints) {
      for (const msg of Object.values(e.constraints)) out.push(`${path}: ${msg}`)
    }
    if (e.children && e.children.length) {
      const childPath = Array.isArray(e.target) ? `${parent}[${e.property}]` : path
      out.push(...flattenValidationErrors(e.children, childPath))
    }
  }
  return out
}

async function bootstrap(): Promise<void> {
  // 生产运行时启动门禁（fail-closed）：JWT_SECRET / FILE_STORAGE_DRIVER / DATABASE_URL
  // 任一不满足生产安全底线即拒绝启动。必须在 NestFactory.create 之前，
  // 让进程在装载任何模块/连接外部依赖前就快速失败。
  assertProductionRuntimeGates()

  const { AppModule } = await import('./app.module')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // express 接管 json body parser,带 verify 回调写入 req.rawBody
    bodyParser: false,
  })
  // 可信反代跳数：生产必须显式 TRUST_PROXY_HOPS=1..9；禁止 true。
  // 配置后 Express 填充 req.ip，控制器只读 req.ip，不得手解析 X-Forwarded-For。
  const trustProxyHops = resolveTrustProxyHops()
  if (trustProxyHops !== false) {
    app.set('trust proxy', trustProxyHops)
  }
  // 手动装 json + urlencoded parser：对 sync webhook 与支付回调路径保留 rawBody（alipay notify
  // 是 form-urlencoded，两个 parser 都必须挂 verify —— C5-6 双模型审查修复）。装配实现与
  // verify 脚本共用 config/body-parsers.ts，防真实入口与测试口径漂移。
  // path-prefix 包含 api/v1 因为这是 setGlobalPrefix 之前的原始 url。
  installBodyParsers(app)
  app.setGlobalPrefix('api/v1')

  // Helmet：设置安全响应头（CSP / X-Frame-Options / HSTS 等）。
  // contentSecurityPolicy 在 dev 会阻断 Vite HMR，故仅生产开启。
  app.use(helmet({
    contentSecurityPolicy: process.env['NODE_ENV'] === 'production',
    crossOriginEmbedderPolicy: false, // kiosk 页面加载第三方资源需要关闭
  }))

  // CORS：dev 允许本机 Vite 端口浮动，生产改为显式白名单。
  const isProd = process.env['NODE_ENV'] === 'production'
  const allowedOrigins = (process.env['CORS_ALLOWED_ORIGINS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  app.enableCors({
    origin: isProd
      ? (allowedOrigins.length ? allowedOrigins : false)
      : true,
    credentials: true,
  })

  // forbidNonWhitelisted:任何超出 DTO 白名单的字段直接 400 拒绝(不静默剥离),
  // 防 body 注入"候选人/邮箱/电话/简历"等合规边界外字段。
  //
  // exceptionFactory:把 class-validator 的原生错误包成统一的
  //   { error: { code: 'VALIDATION_FAILED', message, details } }
  // 形状,与 0a 的错误响应体格式一致,前端解析路径单一。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = flattenValidationErrors(errors)
        const message = details.length > 0 ? details[0]! : '请求参数校验失败'
        return new BadRequestException({
          error: { code: 'VALIDATION_FAILED', message, details },
        })
      },
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  const port = process.env['PORT'] ?? 3010
  await app.listen(port)
  console.log(`AI Job Print API running on http://localhost:${port}/api/v1`)

  // 启动期降级如实上屏：运维在部署日只看控制台也能知道「起来了但不完整」。
  // 明细同时可从 GET /api/v1/health 与 GET /api/v1/health/ready 读到。
  const degraded = bootReadiness.degraded()
  if (degraded.length > 0) {
    console.warn(
      `[WARN] API 以降级状态启动：${degraded.map((s) => `${s.subsystem}(${s.code})`).join(', ')}。` +
        '详见 GET /api/v1/health；readiness 探针 GET /api/v1/health/ready 将返回 503。',
    )
  }

  // 出纸资金门禁的可见性：生产已有启动期强制显式声明
  // （production-runtime-gates.ts，缺省抛 PRODUCTION_PAID_BEFORE_CLAIM_UNDECLARED），
  // 但非生产环境缺省即关闭，且此前**全程无任何提示** —— 演示机、预生产、
  // 现场联调机都可能在运维不知情的情况下「未支付也能被 Agent 领走出纸」。
  // 这里只做启动告警，不改变任何行为。
  if (!requirePaidBeforeClaim()) {
    console.warn(
      '[WARN] PRINT_REQUIRE_PAID_BEFORE_CLAIM 未开启：未支付订单可被 Agent 领取并出纸。' +
        '若本机用于真实收款场景，请显式设为 true。',
    )
  }
}

// 启动失败必须是「一条明确的致命行 + 非 0 退出码」，不能只留一个 unhandled rejection。
// 硬依赖（数据库 / 生产运行时门禁）失败走这里；软依赖（Redis）走 degraded-start，
// 不在这里退出，语义见 src/common/redis/redis.module.ts 与 src/common/boot/boot-readiness.ts。
bootstrap().catch((error: unknown) => {
  console.error('[FATAL] API_BOOTSTRAP_FAILED —— 服务未启动，端口未监听。', error)
  process.exit(1)
})
