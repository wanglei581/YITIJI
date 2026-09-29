import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AI_MANUAL_PATH_METADATA, AI_USE_METADATA, MAINTENANCE_BLOCKED_METADATA, type AiManualPath, type AiUseKind } from './ai-access.decorator'
import { AiAccessService } from './ai-access.service'

@Injectable()
export class AiAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: AiAccessService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<AiUseKind | undefined>(AI_USE_METADATA, [context.getHandler(), context.getClass()])
    const maintenance = this.reflector.getAllAndOverride<boolean>(MAINTENANCE_BLOCKED_METADATA, [context.getHandler(), context.getClass()]) === true
    if (!kind && !maintenance) return true
    const req = context.switchToHttp().getRequest()
    const manual = this.reflector.getAllAndOverride<AiManualPath | undefined>(AI_MANUAL_PATH_METADATA, [context.getHandler(), context.getClass()])
    // 手动路径（不经过模型）：只保留维护模式这一道，AI 闸门一律不拦。
    if (manual && manual.when(req)) {
      await this.access.enforce(undefined, true, req)
      return true
    }
    await this.access.enforce(kind, maintenance, req)
    return true
  }
}
