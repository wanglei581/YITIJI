import { Injectable } from '@nestjs/common'

type ForgetChatOwner = (ownerKey: string) => number

/**
 * 登出、删记录要清小青对话内存，但会员登录模块不能去引 AI 模块（那会绕回自己）。
 * 对话服务起来时把自己的清理函数挂上来，这边只负责转发。
 */
@Injectable()
export class ConversationMemoryBridge {
  private forget: ForgetChatOwner | null = null

  bindChatOwner(forget: ForgetChatOwner): void {
    this.forget = forget
  }

  forgetChatOwner(ownerKey: string): number {
    if (!ownerKey || !this.forget) return 0
    return this.forget(ownerKey)
  }
}
