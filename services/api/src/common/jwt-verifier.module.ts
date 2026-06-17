/**
 * 共享 JwtModule 异步注册（fail-closed 验签）。
 *
 * 各模块（terminals / files / audit / content / materials / print-jobs / smart-campus）
 * 的 JwtAuthGuard 需要 JwtService 验签。历史上它们各自注册 JwtModule，并在
 * 缺失 JWT_SECRET 时静默回退到弱密钥，属安全缺口。
 *
 * 此处统一为与 auth.module.ts 一致的 fail-closed 异步注册：缺失或长度 < 16 直接抛错，
 * 模块装载期即拒绝启动，杜绝弱密钥回退。
 *
 * 业务模块导入 JwtVerifierModule 后即可为 JwtAuthGuard 提供 JwtService。
 */
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

const MIN_JWT_SECRET_LENGTH = 16

export function resolveJwtSecret(): string {
  const secret = process.env['JWT_SECRET']
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      'JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。',
    )
  }
  return secret
}

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: resolveJwtSecret() }),
    }),
  ],
  exports: [JwtModule],
})
export class JwtVerifierModule {}
