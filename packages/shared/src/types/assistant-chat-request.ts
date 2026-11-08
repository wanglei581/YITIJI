import type { AssistantSkill } from './ai'

export interface AssistantChatRequest {
  message: string
  sessionId?: string
  /** 正在讲解的政策编号；原文只由服务端读取。 */
  policyId?: string
  /** 百宝箱 / 助手入口传入的受控首方技能；为空时后端按消息兜底分类 */
  skill?: AssistantSkill
  /** 缺省为 kiosk。miniapp 只返回小程序已注册页面的 actions，并收紧回复。 */
  channel?: 'kiosk' | 'miniapp'
  /** 当前页面上下文（如当前模块、设备状态等） */
  context?: Record<string, unknown>
}
