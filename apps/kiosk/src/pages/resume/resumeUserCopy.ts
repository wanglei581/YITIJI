/** 无错误码的简历结果只映射已知原因，不把任意 reason 或 warning 原文展示出来。 */
export function resumeUserReason(reason: string | undefined | null, fallback: string): string {
  if (!reason) return fallback
  if (/过期|已清理|重新上传/.test(reason)) return '这份文件已无法继续使用，请重新上传简历。'
  if (/额度|配额|次数.*用完|次数.*上限/.test(reason)) return '今日 AI 解析次数已用完，可以先手动整理或打印材料。'
  if (/演示模式/.test(reason)) return '当前为演示模式，未连接真实 AI 服务。'
  if (/不支持.*格式|不支持.*类型|格式.*不支持/.test(reason)) return '不支持的文件类型，请改用 PDF 或清晰图片。'
  if (/文字.*不足|文字.*失败|识别失败|不清晰/.test(reason)) return '没有读出足够清晰的文字，请换一份清晰的简历。'
  if (/超时|繁忙/.test(reason)) return '处理暂时未能完成，请稍后再试。'
  return fallback
}

/** 本地已有的意图保护文案：只替换技术称呼，不改变已扣次、复查和双确认等事实。 */
export function resumeProcessCopy(copy: string): string {
  return copy.replace(/服务端/g, '系统').replace(/本机会话/g, '这次办理').replace(/会话/g, '办理')
}
