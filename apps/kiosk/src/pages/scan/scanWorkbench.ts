import type { LucideIcon } from 'lucide-react'
import {
  CloudIcon,
  CreditCardIcon,
  FileTextIcon,
  FolderIcon,
  MonitorIcon,
  ScanLineIcon,
} from 'lucide-react'

export type ScanType = 'resume' | 'id' | 'document'

export const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  resume: '简历扫描',
  id: '证件扫描',
  document: '普通文档',
}

export function isScanType(value: unknown): value is ScanType {
  return value === 'resume' || value === 'id' || value === 'document'
}

export interface ScanTypeOption {
  type: ScanType
  label: string
  description: string
  chips: { label: string; tone?: 'ok' | 'warn' }[]
  icon: LucideIcon
}

/** 类型卡文案按运行时真值：服务端不转换格式，不得写「生成 PDF」。 */
export const SCAN_TYPE_OPTIONS: ScanTypeOption[] = [
  {
    type: 'resume',
    label: '简历扫描',
    description: '扫描纸质简历，按设备回传格式保存，可进入 AI 识别与优化，也可打印',
    chips: [{ label: '支持 AI 简历识别', tone: 'ok' }, { label: '按回传格式保存' }],
    icon: FileTextIcon,
  },
  {
    type: 'id',
    label: '证件扫描',
    description: '扫描证件原件存档；证件类文件设有效期并自动清理',
    chips: [{ label: '敏感文件 · 自动清理', tone: 'warn' }, { label: '按回传格式保存' }],
    icon: CreditCardIcon,
  },
  {
    type: 'document',
    label: '普通文档',
    description: '扫描通用材料，按设备回传格式保存；未登录不会进入「我的文档」',
    chips: [{ label: '按回传格式保存' }, { label: '可打印' }],
    icon: ScanLineIcon,
  },
]

export const SCAN_CHAIN = [
  { title: '在面板扫描', copy: '放好纸，按开始', who: '你在打印机上按', icon: FileTextIcon },
  { title: '本机接收', copy: '落到共享目录', who: '奔图 → 共享目录', icon: FolderIcon },
  { title: '本地投递', copy: '自动送往服务端', who: '本机终端程序', icon: MonitorIcon },
  { title: '服务端保存', copy: '按回传原格式保存', who: '服务端', icon: CloudIcon },
] as const

export const SCAN_TRUTH = [
  { title: '链路', body: '奔图面板手动扫描 → 本机接收 → 本地投递 → 服务端保存，四段都走完才有文件。' },
  { title: '不画什么', body: '没有页级扫描进度与逐张计数，也不展示具体硬件故障原因。' },
  { title: '留存与费用', body: '留存按文件类型与服务端留存规则管理；价格只在打印流程里由服务端报价给出。' },
] as const

export interface ScanAsk {
  text: string
  em: string
  doing: string
}

export const SCAN_ASK = {
  setup: {
    text: '扫描这一步，在机器面板上做。',
    em: '在机器面板上做',
    doing: '屏幕上没有「开始扫描」这个按钮 —— 本机不能远程驱动扫描仪。你在奔图面板上扫，文件回传到这里。',
  },
  blocked: {
    text: '这一台现在不能建扫描会话。',
    em: '不能建扫描会话',
    doing: '能力还没确认或尚未开放。本页不会创建扫描任务，也不会假装扫描仪已经就绪。',
  },
  unknown: {
    text: '扫描能力此刻读不到。',
    em: '读不到',
    doing: '拿不到配置就不创建任务。恢复后再试；扫描仍要在奔图面板上做。',
  },
  loading: {
    text: '正在确认这台机器的扫描能力。',
    em: '确认',
    doing: '确认之前不创建扫描会话，也不显示任务编号。',
  },
  'usb-panel': {
    text: '文件只进你的 U 盘。',
    em: '只进你的 U 盘',
    doing: '这条路不创建平台任务、不显示进度，也不进入「我的文档」。以奔图面板提示为准。',
  },
  'create-loading': {
    text: '正在建会话。',
    em: '建会话',
    doing: '建成之前不给你任务编号 —— 免得你照着一个不存在的号去面板上操作。',
  },
  'create-failed': {
    text: '会话没建成。',
    em: '没建成',
    doing: '现在去面板扫也没用：文件回来了也没有会话认领它。',
  },
  invalid: {
    text: '这一页没有可创建的扫描类型。',
    em: '没有可创建的扫描类型',
    doing: '请从扫描首页选类型再进来。本页不会凭空发创建请求。',
  },
  expired: {
    text: '会话过期了。',
    em: '过期了',
    doing: '有效期内没等到文件。重新开始就行。',
  },
  'panel-instruction': {
    text: '接下来去机器面板上。',
    em: '去机器面板上',
    doing: '下面几步都在那台奔图上按；扫完回这台屏幕，等待页会自动查。',
  },
  'waiting-delivery': {
    text: '正在等文件回来。',
    em: '等文件回来',
    doing: '我每隔几秒自动问一次服务端。面板、共享目录、本机投递这三段我都看不见，只能转达服务端那一头的回执。',
  },
  polling: {
    text: '正在问服务端。',
    em: '问服务端',
    doing: '回执没到之前，我不改任何判断。',
  },
  'poll-failed': {
    text: '状态没查到。',
    em: '没查到',
    doing: '查不到不等于扫失败。我不改判，过几秒自动再查。别重复扫。',
  },
  cancelling: {
    text: '正在发取消请求。',
    em: '发取消请求',
    doing: '成不成由服务端定，我不提前说已取消。',
  },
  completed: {
    text: '文件到了。',
    em: '到了',
    doing: '服务端回了完成、也带齐了文件字段，我才画出来。预览走回执里的签名链接，不另调要登录的预览签发接口。',
  },
  'completed-no-file': {
    text: '完成了，可回执里没有文件。',
    em: '可回执里没有文件',
    doing: '回执里 file 是空的。我不猜它还在不在服务端，这一屏也就到此为止。',
  },
  failed: {
    text: '这次没扫成。',
    em: '没扫成',
    doing: '原因以服务端返回为准。页面不猜具体纸张或机器故障原因。',
  },
} as const satisfies Record<string, ScanAsk>

export type ScanWorkbenchState = keyof typeof SCAN_ASK
