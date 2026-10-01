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
  clearing: { tone: 'unknown', label: '正在清除这台机器上的这次使用记录' },
}

/**
 * 第一条按登录态说具体的那一个。稿 04 写的是合并式的「登录态或本次匿名会话」——
 * 准确，但把「哪个适用于你」留给用户自己判断；旧页是分开说的（匿名使用 / 登录状态），
 * 那份具体性属于代码自己持有的诚实性，迁移时保住。
 */
export function sessionGuardClears(isAnonymous: boolean) {
  return [
    { title: '本机会清除', items: [
      isAnonymous ? '匿名使用：清掉这次留下的内容' : '登录状态：退出账号，下次需重新验证',
      '本次上传的文件缓存与预览', 'AI 顾问对话与没提交的填写内容', '浏览与选择留下的临时上下文'] },
    { title: '不因此清除', items: ['已创建的打印 / 扫描任务继续运行', '账号里的文档、订单、AI 记录按系统的保存期限管理', '已下过单的到机码照常能用'] },
  ] as const
}


export const SESSION_GUARD_ASKS = [
  { title: '我只是在看屏幕上的字', body: '点「我还在，继续使用」就行。刚才填到一半的内容不会因此丢掉。' },
  { title: '我的打印订单会不会没了', body: '不会。订单在系统里，清场只动这台机器。带到机码回来，或登录后到「我的 · 打印订单」查。' },
  { title: '纸还在机器上', body: '屏幕能清干净，纸不会自己收走。离开前请把原件和打印件一起带走。' },
] as const

/**
 * 来源页 route → 屏上写的页面名。**「继续后回到」的正文与按钮读屏名都只从这里取**，
 * 不许各写各的，也不许把路径本身显示出来（稿 v2 README 规则 4：屏上只写页面名，不写路径）。
 * 名字照稿 04-session-guard.html 的 ROUTE_NAME / pageName；稿里按域兜底的几条原样保留，
 * 另补运行时合并工作台后的域根（/scan、/interview 等，pathname 就是域根本身）。
 */
const SOURCE_PAGE_NAME: Readonly<Record<string, string>> = {
  '/': '首页', '/login': '登录', '/assistant': '问小青', '/help': '帮助', '/session-resume': '继续上次办理',
  '/error-offline': '机器状态', '/print-scan': '打印扫描', '/print-scan/convert': '图片转 PDF', '/print-scan/sign': '签名',
  '/print/pickup-claim': '到机码', '/print/upload': '选择文件', '/print/material-check': '核对材料', '/print/preview': '打印预览',
  '/print/confirm': '确认打印', '/print/cashier': '收银台', '/print/progress': '打印进度', '/print/done': '打印完成',
  '/scan': '扫描', '/scan/start': '扫描', '/resume-service': '改简历', '/resume/source': '选择简历', '/resume/parse': '识别简历',
  '/resume/report': '简历报告', '/resume/optimize': '改简历', '/resume/generate': '生成简历', '/resume/materials': '求职材料',
  '/interview-service': '练面试', '/policy-service': '查政策', '/profile': '我的', '/me/settings': '账号设置',
  '/toolbox': '百宝箱', '/smart-campus': '智慧校园', '/renshi': '查政策',
}

export function sessionGuardSourceName(route: string): string {
  const path = route.split(/[?#]/)[0] ?? ''
  const exact = SOURCE_PAGE_NAME[path]
  if (exact) return exact
  if (path.startsWith('/resume')) return '改简历'
  if (path.startsWith('/print') || path.startsWith('/scan')) return '打印扫描'
  if (path.startsWith('/interview')) return '练面试'
  if (path.startsWith('/policy') || path.startsWith('/renshi')) return '查政策'
  if (path.startsWith('/legal')) return '协议与隐私'
  if (path.startsWith('/me')) return '我的'
  return '刚才那一页'
}
