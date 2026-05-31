import 'reflect-metadata'
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'

/**
 * 保留 webhook 路由的 raw body 供 HMAC 校验。
 *
 * Express body-parser 默认 parse 完就丢 raw,但 sync.controller 必须用 raw bytes
 * 重算 HMAC 才能与企业的签名对齐(对 parsed object 重新 JSON.stringify 字段顺序
 * 可能不同,字符级会变,签名失败)。
 *
 * 只对 /api/v1/sync/* 启用,其他路由不背成本。
 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer
}
function rawBodyCaptureFor(prefix: string) {
  return (req: RawBodyRequest, _res: Response, buf: Buffer): void => {
    if (req.url.startsWith(prefix)) {
      req.rawBody = Buffer.from(buf)
    }
  }
}

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // express 接管 json body parser,带 verify 回调写入 req.rawBody
    bodyParser: false,
  })
  // 手动装 json parser:对 sync webhook 路径保留 rawBody;其他路由忽略。
  // path-prefix 包含 api/v1 因为这是 setGlobalPrefix 之前的原始 url。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express') as typeof import('express')
  app.use(express.json({ verify: rawBodyCaptureFor('/api/v1/sync/') }))
  app.use(express.urlencoded({ extended: true }))
  app.setGlobalPrefix('api/v1')

  // CORS:dev 允许任意 origin(本机三端 Vite 端口浮动),
  // 生产应改为显式白名单。`credentials: true` 让浏览器允许
  // 后续可能的 Cookie/Authorization 头携带。
  app.enableCors({
    origin: true,
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
  const port = process.env['PORT'] ?? 3000
  await app.listen(port)
  console.log(`AI Job Print API running on http://localhost:${port}/api/v1`)
}

bootstrap()
