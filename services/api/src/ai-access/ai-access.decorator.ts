import { SetMetadata } from '@nestjs/common'

export type AiUseKind = 'generate' | 'voice' | 'export' | 'read'
export const AI_USE_METADATA = 'ai_access:use'
export const MAINTENANCE_BLOCKED_METADATA = 'ai_access:maintenance_blocked'
export const AI_USE_EXEMPT_METADATA = 'ai_access:use_exempt'

export const AiUse = (kind: AiUseKind) => SetMetadata(AI_USE_METADATA, kind)
export const MaintenanceBlocked = () => SetMetadata(MAINTENANCE_BLOCKED_METADATA, true)
export const AiUseExempt = (reason: string) => SetMetadata(AI_USE_EXEMPT_METADATA, reason)

export const AI_MANUAL_PATH_METADATA = 'ai_access:manual_path'
export interface AiManualPath {
  /** 只读请求体 / 查询里**已解析**的值做判断；判不出一律返回 false（照常过 AI 闸门，失败关闭）。 */
  when: (req: { body?: unknown; query?: unknown }) => boolean
  /** 为什么这条路径不经过模型、可以绕开 AI 闸门（写给审查的人看）。 */
  reason: string
}
/**
 * 同一个接口里「不经过模型」的手动路径（例：简历按原样导出 draft=true）：命中时只保留维护模式这一道，
 * 跳过 AI 暂停 / 未开通 / 额度 / 声明 / 登录档位这些 AI 闸门——AI 挂了，手动退路不能跟着没（AI 是加速器不是前置条件）。
 * 与 @AiUse 同时挂：没命中时照 @AiUse 的类别过闸。
 */
export const AiManualPathWhen = (manual: AiManualPath) => SetMetadata(AI_MANUAL_PATH_METADATA, manual)
