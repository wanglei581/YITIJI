import 'reflect-metadata'
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'

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
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api/v1')

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
