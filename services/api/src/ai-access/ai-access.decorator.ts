import { SetMetadata } from '@nestjs/common'

export type AiUseKind = 'generate' | 'voice' | 'export' | 'read'
export const AI_USE_METADATA = 'ai_access:use'
export const MAINTENANCE_BLOCKED_METADATA = 'ai_access:maintenance_blocked'
export const AI_USE_EXEMPT_METADATA = 'ai_access:use_exempt'

export const AiUse = (kind: AiUseKind) => SetMetadata(AI_USE_METADATA, kind)
export const MaintenanceBlocked = () => SetMetadata(MAINTENANCE_BLOCKED_METADATA, true)
export const AiUseExempt = (reason: string) => SetMetadata(AI_USE_EXEMPT_METADATA, reason)
