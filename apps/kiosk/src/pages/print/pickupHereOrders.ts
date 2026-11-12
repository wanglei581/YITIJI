/**
 * 一体机取件页：本人、本机、还没取的手机单。
 *
 * 文件名打码与 services/api/src/print-jobs/pickup-file-mask.ts 同一算法。
 * 一体机不从后端源码导入。屏上只留打码后的名字，不留原始文件名，也不留到机码。
 */
import { preferUnattended } from '../../copy/unattendedCopy'

/** 核销回执里的文件名：保留首字与扩展名，其余打码。不含正文。 */
export function maskPickupFileName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const baseName = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const dot = baseName.lastIndexOf('.')
  const ext = dot > 0 && dot < baseName.length - 1 ? baseName.slice(dot) : ''
  const stem = ext ? baseName.slice(0, baseName.length - ext.length) : baseName
  const head = Array.from(stem)[0] ?? ''
  if (!head) return `***${ext}`
  return `${head}***${ext}`
}

/** 时间线里用得到的字段。到机码和原始文件名不进这一层的输出。 */
export interface PickupHereSource {
  kind: string
  orderId: string | null
  title: string | null
  itemCount: number
  claimableHere: boolean
}

export interface PickupHereRow {
  orderId: string
  label: string
}

/** 只留手机单件和材料包，并且服务端已经判定能在这台机器领。现场单不进这张表。 */
export function pickupHereRows(items: readonly PickupHereSource[]): PickupHereRow[] {
  const rows: PickupHereRow[] = []
  for (const item of items) {
    if (item.claimableHere !== true) continue
    if (item.kind !== 'cloud_single' && item.kind !== 'package') continue
    if (typeof item.orderId !== 'string' || item.orderId.length === 0) continue
    const label = item.kind === 'package'
      ? (Number.isInteger(item.itemCount) && item.itemCount > 0 ? `材料包 · ${item.itemCount} 个文件` : '材料包')
      : (maskPickupFileName(item.title) ?? '文件')
    rows.push({ orderId: item.orderId, label })
  }
  return rows
}

/** 点领取时服务端说这单不在这台机器。不用「到机码无效」那句，因为人没有输码。 */
export const PICKUP_HERE_OTHER_MACHINE =
  '这笔订单不在这台机器取件，请到下单时选的网点领取'

export function pickupHereMismatchMessage(serverMessage: string): string {
  return preferUnattended(serverMessage.trim(), PICKUP_HERE_OTHER_MACHINE)
}
