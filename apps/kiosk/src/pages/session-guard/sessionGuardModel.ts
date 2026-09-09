export type SessionGuardState = 'warning' | 'warning-no-continue' | 'clearing'

export function deriveSessionGuardState(args: {
  clearing: boolean
  canContinue: boolean | undefined
}): SessionGuardState {
  if (args.clearing) return 'clearing'
  if (args.canContinue === true) return 'warning'
  return 'warning-no-continue'
}

export function remainingSeconds(deadlineAt: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000))
}

export const SESSION_GUARD_PILL: Record<SessionGuardState, { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }> = {
  warning: { tone: 'warn', label: '闲置提醒 · 本机计时' },
  'warning-no-continue': { tone: 'warn', label: '已到最长安全时限' },
  clearing: { tone: 'unknown', label: '正在清除本机会话' },
}

/**
 * 第一条按登录态说具体的那一个。稿 04 写的是合并式的「登录态或本次匿名会话」——
 * 准确，但把「哪个适用于你」留给用户自己判断；旧页是分开说的（匿名使用 / 登录状态），
 * 那份具体性属于代码自己持有的诚实性，迁移时保住。
 */
export function sessionGuardClears(isAnonymous: boolean) {
  return [
    { title: '本机会清除', items: [
      isAnonymous ? '匿名使用：清除本次匿名会话' : '登录状态：退出账号，下次需重新验证',
      '本次上传的文件缓存与预览', 'AI 顾问对话与没提交的填写内容', '浏览与选择留下的临时上下文'] },
    { title: '不因此清除', items: ['已创建的打印 / 扫描任务继续运行', '账号里的文档、订单、AI 记录按服务端留存期限管理', '已下过单的到机码照常能用'] },
  ] as const
}


export const SESSION_GUARD_ASKS = [
  { title: '我只是在看屏幕上的字', body: '点「我还在，继续使用」就行。刚才填到一半的内容不会因此丢掉。' },
  { title: '我的打印订单会不会没了', body: '不会。订单在服务端，清场只动这台机器。带到机码回来，或登录后到「我的 · 打印订单」查。' },
  { title: '纸还在机器上', body: '屏幕能清干净，纸不会自己收走。离开前请把原件和打印件一起带走。' },
] as const
