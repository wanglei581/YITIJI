import type { LucideIcon } from 'lucide-react'
import {
  CreditCardIcon,
  FileTextIcon,
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

/**
 * 类型卡小标按 2.0 稿，但「生成 PDF」不能写：服务端存的是设备回传原字节，不转换。
 * 小标用「按回传格式保存」顶替那一枚。
 */
export const SCAN_TYPE_OPTIONS: ScanTypeOption[] = [
  {
    type: 'resume',
    label: '简历扫描',
    description: '扫描纸质简历，可进入 AI 识别与优化，也可拿去打印',
    chips: [
      { label: '支持 AI 简历识别', tone: 'ok' },
      { label: '按回传格式保存' },
      { label: '面板 4 步' },
    ],
    icon: FileTextIcon,
  },
  {
    type: 'id',
    label: '证件扫描',
    description: '扫描证件原件；证件类短期留存，不可延长保存期限',
    chips: [
      { label: '高敏 · 短期留存', tone: 'warn' },
      { label: '按回传格式保存' },
      { label: '正反面各扫一次' },
    ],
    icon: CreditCardIcon,
  },
  {
    type: 'document',
    label: '普通文档',
    description: '扫描通用材料；证书、成绩单、报到证这类都算',
    chips: [
      { label: '按回传格式保存' },
      { label: '可拿去打印' },
      { label: '面板 3 步' },
    ],
    icon: ScanLineIcon,
  },
]

export const SCAN_CHAIN = [
  { title: '放纸', copy: '把材料放进进纸器，或平放在玻璃板上', who: '第 1 步', icon: FileTextIcon },
  { title: '在打印机面板上按扫描', copy: '屏幕上没有开始扫描按钮', who: '第 2 步', icon: ScanLineIcon },
  { title: '文件回到这台机器', copy: '扫完回到这里，等这份 PDF', who: '第 3 步', icon: MonitorIcon },
] as const

export const SCAN_TRUTH = [
  { title: '怎么扫', body: '放纸，在打印机面板上按扫描，文件回到这台机器。' },
  { title: '这一页不做', body: '屏幕上不能远程开始扫描，也不显示扫到第几张。' },
  { title: '彩色和双面', body: '本机暂未开通。费用到打印那一步再看实际价格。' },
] as const

export interface ScanAsk {
  text: string
  em: string
  doing: string
}

export const SCAN_ASK = {
  setup: {
    text: '先放纸，再去打印机面板。',
    em: '打印机面板',
    doing: '在面板上按扫描，文件会回到这台机器。屏幕上没有开始扫描按钮。',
  },
  blocked: {
    text: '这一台现在不能建立这次扫描。',
    em: '不能建立这次扫描',
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
    doing: '确认之前不建立这次扫描，也不显示任务编号。',
  },
  'usb-panel': {
    text: '文件只进你的 U 盘。',
    em: '只进你的 U 盘',
    doing: '这条路不创建平台任务、不显示进度，也不进入「我的文档」。以奔图面板提示为准。',
  },
  'create-loading': {
    text: '正在建立这次扫描。',
    em: '建立这次扫描',
    doing: '建成之前不给你任务编号 —— 免得你照着一个不存在的号去面板上操作。',
  },
  'create-failed': {
    text: '这次扫描没建好。',
    em: '没建好',
    doing: '现在去面板扫也没用：文件回来了也没有这次扫描来接收它。',
  },
  'cleanup-holding': {
    text: '上一场扫描还没收完尾。',
    em: '还没收完尾',
    doing: '本机正在向系统确认上一位那条任务确实已经取消。确认之前不建立新的一次扫描 —— 系统会把面板上扫出来的文件交给这台机器上最早那条还在等文件的任务。',
  },
  invalid: {
    text: '这一页没有可创建的扫描类型。',
    em: '没有可创建的扫描类型',
    doing: '请从扫描首页选类型再进来。本页不会凭空发创建请求。',
  },
  expired: {
    text: '这次扫描过期了。',
    em: '过期了',
    doing: '有效期内没等到文件。重新开始就行。',
  },
  'awaiting-ack': {
    text: '这次扫描已经建好，还没拿到投递授权。',
    em: '还没拿到投递授权',
    doing: '系统确认之前，面板上扫出来的文件不会交到这一场，所以先别按开始。它也不会被别人收走 —— 没确认的任务不会接收任何文件。',
  },
  'panel-instruction': {
    text: '接下来去机器面板上。',
    em: '去机器面板上',
    doing: '下面几步都在那台奔图上按；扫完回这台屏幕，等待页会自动查。',
  },
  'waiting-delivery': {
    text: '正在等文件回来。',
    em: '等文件回来',
    doing: '我每隔几秒自动问一次系统。面板上的扫描结果回来前，这里只转达系统给出的结果。',
  },
  polling: {
    text: '正在问系统。',
    em: '问系统',
    doing: '结果没到之前，我不改任何判断。',
  },
  'poll-failed': {
    text: '状态没查到。',
    em: '没查到',
    doing: '查不到不等于扫失败。我不改判，过几秒自动再查。别重复扫。',
  },
  cancelling: {
    text: '正在发取消请求。',
    em: '发取消请求',
    doing: '成不成由系统定，我不提前说已取消。',
  },
  completed: {
    text: '文件到了。',
    em: '到了',
    doing: '系统回了完成、也带齐了文件信息，我才画出来。',
  },
  'completed-no-file': {
    text: '完成了，可结果里没有文件。',
    em: '可结果里没有文件',
    doing: '结果里没有文件。我不猜它还在不在系统里，这一屏也就到此为止。',
  },
  /* 结果页的 failed / wait-timeout 两态也接本机自己放弃的路（轮询到点、连续查不动），
   * 那时服务端并没有说过「失败」或「过期」—— 所以这两句只说对所有成因都成立的话，
   * 具体成因由结果页那一行原因转达。 */
  failed: {
    text: '这次没扫成。',
    em: '没扫成',
    doing: '这次没有拿到可用文件，原因见下方说明。页面不猜具体纸张或机器故障原因。',
  },
  'wait-timeout': {
    text: '这次没等到文件。',
    em: '没等到文件',
    doing: '等待超过了时限，这次没有拿到可用文件。重新开始一次就行。',
  },
} as const satisfies Record<string, ScanAsk>

export type ScanWorkbenchState = keyof typeof SCAN_ASK
