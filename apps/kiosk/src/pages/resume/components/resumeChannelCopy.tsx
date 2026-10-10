import type { ReactNode } from 'react'
import { heroCopy, type SourceHeroKey } from './resumeSourceHero'
import { sourceFrameStatus, type ResumeScreen, type UploadChannel } from './resumeSourceModel'

export type UsbChannelPhase =
  | 'usb-detecting'
  | 'usb-wait'
  | 'usb-list'
  | 'usb-empty'
  | 'usb-read-failed'
  | 'usb-agent-offline'
  | 'usb-importing'
  | 'usb-import-failed'

/** 通道整屏的任务头。只给运行页真会停住的态换一句，不造稿上没有出路的画面。 */
export function channelHero(state: string, intent: 'diagnose' | 'optimize'): {
  ask: ReactNode
  doing: ReactNode
  flag: string
  warn: boolean
} | null {
  const verb = intent === 'optimize' ? '优化' : '诊断'
  if (state === 'usb-wait') return { ask: <>把 U 盘<em>插在这台机器上</em>。</>, doing: '插好之后每 2 秒看一次有没有盘。没插上就不会有列表。', flag: '等待插入', warn: false }
  if (state === 'usb-detecting') return { ask: <>正在<em>读 U 盘目录</em>。</>, doing: '一次读完才出结果。这里不画进度条。', flag: '读取中', warn: false }
  if (state === 'usb-list') return { ask: <>盘上这几份<em>可以用</em>。</>, doing: '点一份就开始导入。一次只导入你点的那一个文件。', flag: '选一份', warn: false }
  if (state === 'usb-empty') return { ask: <>盘读到了，<em>但没有能用的文件</em>。</>, doing: '只看最外层的 PDF / JPG / PNG，单份不超过 10MB。', flag: '空列表', warn: true }
  if (state === 'usb-read-failed') return { ask: <>这次<em>没读出 U 盘</em>。</>, doing: '本机不会猜盘里有什么，也不显示上一次的列表。', flag: '读取失败', warn: true }
  if (state === 'usb-agent-offline') return { ask: <>读 U 盘<em>暂时没连上</em>。</>, doing: 'U 盘导入是开通的，只是这会儿没连上本机程序。', flag: '连接失败', warn: true }
  if (state === 'usb-importing') return { ask: <>正在把这一份<em>导入本次办理</em>。</>, doing: '没有中止入口。离开这一页不会撤回已经发出的导入。', flag: '导入中', warn: false }
  if (state === 'usb-import-failed') return { ask: <>这一份<em>没能导进来</em>。</>, doing: '不能原地再导同一份，要重新读一次盘再选。', flag: '导入失败', warn: true }
  if (state === 'usb-ready') return { ask: <>这一份<em>已经导进来了</em>。</>, doing: '文件已经在本次办理里，现在可以拔 U 盘了。', flag: '已导入', warn: false }
  if (state === 'local-guide') return { ask: <>云盘文件<em>先下载到这台机器</em>。</>, doing: '打开的是本机文件选择，不登录、不保存云盘账号。', flag: '本机目录', warn: false }
  if (state === 'local-cancelled') return { ask: <>这次<em>没有选文件</em>。</>, doing: '选择被关掉了，什么都没有被读取或上传。', flag: '已取消', warn: true }
  if (state === 'local-oversize') return { ask: <>这一份<em>太大了</em>。</>, doing: '单个文件不能超过 10MB。这一份没有被上传。', flag: '超过上限', warn: true }
  if (state === 'local-unreadable') return { ask: <>这一份<em>读不出内容</em>。</>, doing: '文件是空的。本机不会上传一个读不出内容的文件。', flag: '读不出来', warn: true }
  if (state === 'local-ready') return { ask: <>系统<em>已经确认收到</em>。</>, doing: <>下面的文件名和大小是系统发回的结果。确认之后才开始{verb}。</>, flag: '已收到', warn: false }
  if (state === 'phone') return { ask: <>用手机<em>扫码上传</em>。</>, doing: '每次办理一张码，有效期以系统给出的到期时间为准。传完回这里确认。', flag: '手机扫码', warn: false }
  return null
}

export function channelPill(state: string): string {
  const pills: Record<string, string> = {
    'usb-wait': 'U 盘 · 等待插入',
    'usb-detecting': 'U 盘 · 读取中',
    'usb-list': 'U 盘 · 选一份',
    'usb-empty': 'U 盘 · 没有可用文件',
    'usb-read-failed': 'U 盘 · 读取失败',
    'usb-agent-offline': 'U 盘 · 暂时没连上',
    'usb-importing': 'U 盘 · 导入中',
    'usb-import-failed': 'U 盘 · 导入失败',
    'usb-ready': 'U 盘 · 已导入',
    'local-guide': '本机文件 · 准备',
    'local-cancelled': '本机文件 · 已取消',
    'local-oversize': '本机文件 · 超过 10MB',
    'local-unreadable': '本机文件 · 读不出内容',
    'local-ready': '本机文件 · 已收到',
    phone: '手机扫码',
  }
  return pills[state] ?? '第 1 步 · 取简历文件'
}

/** 来源页顶栏用的真实阶段。通道没打开时仍走原来的 heroKey。 */
export function sourcePhaseView(input: {
  screen: ResumeScreen | 'unknown'
  intent: 'diagnose' | 'optimize'
  uploading: boolean
  uploadRecheck: boolean
  uploadUnknown: boolean
  error: string | null
  scanReady: boolean
  hasFile: boolean
  selected: UploadChannel
  channelScreen: null | 'usb' | 'phone' | 'local'
  held: boolean
  usbPhase: UsbChannelPhase
  localPhase: string
  receiving: boolean
}): {
  stateAttr: string
  usbOffline: boolean
  hero: ReturnType<typeof heroCopy>
  frameStatus: { tone: 'ok' | 'warn' | 'unknown'; label: string }
} {
  const heroKey: SourceHeroKey = input.screen === 'unknown' ? 'unknown'
    : input.screen === 'target' || input.screen === 'target-context' || input.screen === 'target-profile' || input.screen === 'target-industry' ? input.screen
    : input.uploading ? 'uploading' : input.uploadRecheck ? 'upload-rechecking' : input.uploadUnknown ? 'upload-unknown'
    : input.error ? 'upload-failed' : input.screen === 'summary' ? (input.scanReady ? 'scan-ready' : 'staged')
    : !input.hasFile && input.selected === 'usb' ? 'usb' : !input.hasFile && input.selected === 'phone' ? 'phone' : 'source'
  const usbOffline = input.channelScreen === 'usb' && !input.held && input.usbPhase === 'usb-agent-offline'
  const phaseState = input.screen !== 'source' || !input.channelScreen ? null
    : input.channelScreen === 'usb' ? (input.held ? 'usb-ready' : input.usbPhase)
    : input.channelScreen === 'local' ? (input.uploading ? 'local-guide' : input.localPhase)
    : 'phone'
  const hero = (phaseState ? channelHero(phaseState, input.intent) : null) ?? heroCopy(heroKey, input.intent)
  const frameStatus = phaseState
    ? { tone: /failed|offline|unreadable|oversize|cancelled/.test(phaseState) ? 'warn' as const : 'unknown' as const, label: channelPill(phaseState) }
    : sourceFrameStatus({
      screen: input.screen, uploading: input.uploading, receiving: input.receiving,
      uploadUnknown: input.uploadUnknown, uploadRecheck: input.uploadRecheck, error: Boolean(input.error),
    })
  return { stateAttr: phaseState ?? heroKey, usbOffline, hero, frameStatus }
}
