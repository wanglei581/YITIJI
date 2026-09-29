/**
 * 一体机 AI 使用声明的全部用户可见文字。
 * 最终文案由协调方把关；改这里即可，不要散落到页面里。
 */

export const AI_AGE_DIALOG_TITLE = '你已年满 14 周岁吗？'
export const AI_AGE_DIALOG_BODY = '使用 AI 分析、语音转文字之前需要确认。未满 14 周岁的，需要监护人同意后才能使用，这台机器暂时办不了。'
export const AI_AGE_CONFIRM_LABEL = '已满'
export const AI_AGE_DECLINE_LABEL = '未满'

export const AI_VOICE_DIALOG_TITLE = '录音单独同意'
export const AI_VOICE_CONFIRM_LABEL = '同意录音'
export const AI_VOICE_DECLINE_LABEL = '改用手打'

/** 与小程序 VOICE_CONSENT_ITEMS 同义，口吻改成公共终端。 */
export const AI_VOICE_CONSENT_ITEMS = [
  '只把你说的话转成文字，用于语音说简历、模拟面试作答，以及向小青提问。',
  '录音交给受托的语音识别服务商腾讯云转成文字。',
  '转完即删，不保存录音。',
  '不做声纹识别，不拿去训练模型。',
  '这次办完就不再沿用。登录后可在「我的」里撤回；没登录的，离开这台机器即不再使用。撤回后请改用手打。',
] as const

export const AI_AGE_BLOCKED_TITLE = '这台机器暂时办不了'
export const AI_VOICE_BLOCKED_TITLE = '这次不录音'
export const AI_DECLARATION_ACK_LABEL = '知道了'

export const AI_AGE_DECLINED_MESSAGE = '未满 14 周岁需要监护人同意，这台机器暂时办不了 AI。打印、扫描和已有材料照常可办。'
export const AI_VOICE_DECLINED_MESSAGE = '这次不录音。请改用手打，文字照常可以提交。'
export const AI_CLEARED_MESSAGE = '这次办理已经结束，请重新开始。'

/** 各 AI 主按钮下的一行说明。字号用 2.0 辅助字阶，不另起一块。 */
export const AI_DECLARATION_NOTE = '使用 AI 即表示你已年满 14 周岁'
