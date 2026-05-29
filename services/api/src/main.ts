import 'reflect-metadata'
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api/v1')
  // forbidNonWhitelisted: 任何超出 DTO 白名单的字段直接 400 拒绝(不静默剥离)。
  // 安全收益:partner 导入接口防止 body 注入"候选人姓名/邮箱/简历"等
  // 合规边界外字段。所有 DTO 必须显式列出允许的字段。
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  const port = process.env['PORT'] ?? 3000
  await app.listen(port)
  console.log(`AI Job Print API running on http://localhost:${port}/api/v1`)
}

bootstrap()
