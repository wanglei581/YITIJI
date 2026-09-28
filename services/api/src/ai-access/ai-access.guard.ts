import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AI_USE_METADATA, MAINTENANCE_BLOCKED_METADATA, type AiUseKind } from './ai-access.decorator'
import { AiAccessService } from './ai-access.service'

@Injectable()
export class AiAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: AiAccessService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<AiUseKind | undefined>(AI_USE_METADATA, [context.getHandler(), context.getClass()])
    const maintenance = this.reflector.getAllAndOverride<boolean>(MAINTENANCE_BLOCKED_METADATA, [context.getHandler(), context.getClass()]) === true
    if (!kind && !maintenance) return true
    await this.access.enforce(kind, maintenance, context.switchToHttp().getRequest())
    return true
  }
}
