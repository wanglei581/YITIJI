import type { LucideIcon } from 'lucide-react'
import {
  CreditCardIcon,
  FileTextIcon,
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

export const SCAN_TRUTH = [
  { title: '怎么做', body: '放好纸 → 面板上按扫描 → 回到这台机器等文件。' },
  { title: '不显示什么', body: '没有页级扫描进度与逐张计数，也不猜具体硬件故障原因。' },
  { title: '文件和费用', body: '文件按类型与保存规则管理；价格只在打印流程里由系统报价给出。' },
] as const

/**
 * 扫描工作台的屏幕状态。键名不能改：页面用它写 data-state、问小青的本屏问句按它选、用例与门禁按这些名字找屏。
 * （原来这里还有一整段给旧横幅用的 ScanAsk 文案，没有任何地方渲染它，只剩键名被当成类型用，已删。）
 */
export type ScanWorkbenchState =
  | 'setup'
  | 'blocked'
  | 'unknown'
  | 'loading'
  | 'usb-panel'
  | 'create-loading'
  | 'create-failed'
  | 'cleanup-holding'
  | 'invalid'
  | 'expired'
  | 'awaiting-ack'
  | 'panel-instruction'
  | 'waiting-delivery'
  | 'polling'
  | 'poll-failed'
  | 'cancelling'
  | 'completed'
  | 'completed-no-file'
  | 'failed'
  | 'wait-timeout'
