// ============================================================
// 材料处理任务的访问控制原语。
//
// 从 MaterialsService 的私有方法提出来，供 MaterialsService 与 PiiRedactionService 共用
// —— 遮挡编排必须对「决策任务」重新做一次归属与过期校验，两处必须是同一套判定，
// 复制一份等于给自己留一条会漂移的旁路。行为与提取前逐字一致。
// ============================================================
import { ForbiddenException, GoneException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import type { MaterialsRequester } from './materials.types'

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function verifyAccessToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashAccessToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function assertCanAccessTask(task: { endUserId: string | null }, requester: MaterialsRequester): void {
  if (!task.endUserId) {
    if (requester.kind !== 'anonymous') {
      throw new ForbiddenException({ error: { code: 'MATERIAL_TASK_ACCESS_DENIED', message: '无权访问该材料处理任务' } })
    }
    const tokenHash = (task as { accessTokenHash?: string | null }).accessTokenHash
    if (tokenHash && requester.accessToken && verifyAccessToken(requester.accessToken, tokenHash)) return
    throw new ForbiddenException({ error: { code: 'MATERIAL_TASK_TOKEN_REQUIRED', message: '缺少或无效的材料任务访问凭证' } })
  }
  if (requester.kind === 'member' && requester.endUserId === task.endUserId) return
  throw new ForbiddenException({ error: { code: 'MATERIAL_TASK_ACCESS_DENIED', message: '无权访问该材料处理任务' } })
}

export function assertTaskNotExpired(task: { expiresAt: Date }): void {
  if (task.expiresAt.getTime() > Date.now()) return
  throw new GoneException({ error: { code: 'MATERIAL_TASK_EXPIRED', message: '材料处理任务已过期' } })
}
