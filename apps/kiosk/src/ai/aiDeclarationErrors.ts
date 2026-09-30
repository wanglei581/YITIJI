import {
  AI_AGE_DECLINED_MESSAGE,
  AI_CLEARED_MESSAGE,
  AI_VOICE_DECLINED_MESSAGE,
} from './aiDeclarationCopy'
import type { DeclarationScope } from './aiDeclarationVersions'

/** 本人选择不用 AI。不是能力故障，不许写进 AI 停用码表。 */
export class AiDeclarationDeclinedError extends Error {
  readonly code = 'AI_DECLARATION_DECLINED'
  readonly scope: DeclarationScope

  constructor(scope: DeclarationScope) {
    super(scope === 'voice_recording' ? AI_VOICE_DECLINED_MESSAGE : AI_AGE_DECLINED_MESSAGE)
    this.name = 'AiDeclarationDeclinedError'
    this.scope = scope
  }
}

/** 确认还没做完，这一次办理已经被清掉。 */
export class AiDeclarationClearedError extends Error {
  readonly code = 'AI_DECLARATION_CLEARED'

  constructor() {
    super(AI_CLEARED_MESSAGE)
    this.name = 'AiDeclarationClearedError'
  }
}

export function aiDeclarationDeclineMessage(error: unknown): string | null {
  if (error instanceof AiDeclarationDeclinedError || error instanceof AiDeclarationClearedError) {
    return error.message
  }
  return null
}

/** 适配器把请求失败一律改写成「网络连接失败」之前，先把声明拒绝原样抛回去。 */
export function rethrowAiDeclaration(error: unknown): void {
  if (error instanceof AiDeclarationDeclinedError || error instanceof AiDeclarationClearedError) {
    throw error
  }
}

export function isAiDeclarationUserText(text: string): boolean {
  return text === AI_AGE_DECLINED_MESSAGE || text === AI_VOICE_DECLINED_MESSAGE || text === AI_CLEARED_MESSAGE
}
