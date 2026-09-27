/** 错误信封仍由 userMessageOf 处理；这里只筛结果中的工程原因，不改写用户提示的原意。 */
export function resumeUserReason(reason: string | undefined | null, fallback: string): string {
  if (!reason?.trim() || !/[\u4e00-\u9fff]/.test(reason)) return fallback
  if (/服务端|服务器|后端|前台|后台|会话|字段|接口|落库|链路|回执|引擎|能力探测|真机|未验收|终端编号|内部文件号|元数据|网桥/.test(reason)) return fallback
  if (/\b(?:pending|uploaded|HTTP|TypeError|ReferenceError|SyntaxError|Error|ECONNREFUSED|ETIMEDOUT|ENOENT|trace[-_ ]?id|taskId|fileId)\b|\b[A-Z][A-Z\d]*_[A-Z\d_]+\b|<[^>]+>/i.test(reason)) return fallback
  return reason
}

/** 本地已有的意图保护文案：只替换技术称呼，不改变已扣次、复查和双确认等事实。 */
export function resumeProcessCopy(copy: string): string {
  return copy.replace(/服务端/g, '系统').replace(/本机会话/g, '这次办理').replace(/会话/g, '办理')
}
