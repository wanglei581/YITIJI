// 自我探索的四个出口（key / title / desc / onClick 由 SelfAssessmentFlow 的 saExits 给）换成触屏的大行动卡。
// 用户可见的中文（标题、说明、「打开」）仍留在 SelfAssessmentFlow（合规关键词扫描点名的文件），这里不放文案。
import type { QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import type { ResumeTouchActItem } from './ResumeTouchActs'

const ICONS: Record<string, QxTouchIconName> = { start: 'pen', hub: 'file', records: 'clipboard', login: 'user' }

export function toSaActItems(
  exits: ReadonlyArray<{ key: string; title: string; desc: string; onClick: () => void }>,
  take: string,
): ResumeTouchActItem[] {
  return exits.map((item) => ({ title: item.title, desc: item.desc, take, icon: ICONS[item.key] ?? 'file', onClick: item.onClick }))
}
