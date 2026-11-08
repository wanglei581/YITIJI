import type { ScanDeviceColorMode, ScanDeviceSource } from '@ai-job-print/shared'
import type { ScanType } from './scanWorkbench'

/** 屏上这一步的材料。合同只是界面上的一种；交给面板流程时按普通文档。 */
export type ScanMaterial = 'resume' | 'id' | 'document' | 'contract'

export function isScanMaterial(value: unknown): value is ScanMaterial {
  return value === 'resume' || value === 'id' || value === 'document' || value === 'contract'
}

export function panelScanType(material: ScanMaterial): ScanType {
  if (material === 'contract') return 'document'
  return material
}

export interface ScanMaterialOption {
  material: ScanMaterial
  label: string
  desc: string
  more: string
  chip?: string
}

/** 四张卡的字照屏上原稿。 */
export const SCAN_MATERIALS: readonly ScanMaterialOption[] = [
  {
    material: 'resume',
    label: '简历',
    desc: '纸质简历，扫成 PDF',
    more: '扫完可以做 AI 简历识别，也可以打印',
  },
  {
    material: 'id',
    label: '证件',
    desc: '身份证、学历证书等原件',
    more: '正反面要各扫一次',
    chip: '敏感文件 · 自动清理',
  },
  {
    material: 'document',
    label: '普通文档',
    desc: '证明、成绩单等多页材料',
    more: '多页的放进纸器，一次扫完',
  },
  {
    material: 'contract',
    label: '合同',
    desc: '多页合同、协议，扫成 PDF',
    more: '扫完是一个 PDF，可以打印',
  },
]

export interface ScanDeviceChoice {
  source: ScanDeviceSource
  colorMode: ScanDeviceColorMode
}

/** 证件默认玻璃台 + 彩色，其余默认进纸器 + 黑白。协议值用 flatbed/feeder 与 gray/color。 */
export function defaultDeviceChoice(material: ScanMaterial): ScanDeviceChoice {
  if (material === 'id') return { source: 'flatbed', colorMode: 'color' }
  return { source: 'feeder', colorMode: 'gray' }
}

export function parseDeviceChoice(raw: unknown): ScanDeviceChoice | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const source = (raw as { source?: unknown }).source
  const colorMode = (raw as { colorMode?: unknown }).colorMode
  if (source !== 'flatbed' && source !== 'feeder') return undefined
  if (colorMode !== 'gray' && colorMode !== 'color') return undefined
  return { source, colorMode }
}
