/**
 * 会员「可开票订单」列表的分页工具：打印单与服务单两张表按同一个全序合并翻页。
 *
 * 全序：创建时间新到旧；同一时刻服务单在打印单前面；同种类按编号倒序。
 * 翻页标记是「上一页最后一张单」在这个全序里的位置，只用于继续往后读，不带任何个人信息。
 */
import { BadRequestException } from '@nestjs/common'

export type InvoiceOrderKind = 'print' | 'service'

export interface ListPosition {
  at: Date
  kind: InvoiceOrderKind
  id: string
}

export const INVOICE_LIST_DEFAULT_LIMIT = 20
export const INVOICE_LIST_MAX_LIMIT = 50

export function clampInvoiceListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit)) return INVOICE_LIST_DEFAULT_LIMIT
  return Math.min(INVOICE_LIST_MAX_LIMIT, Math.max(1, limit))
}

export function encodeListCursor(position: ListPosition): string {
  return Buffer.from(`${position.at.getTime()}.${position.kind}.${position.id}`, 'utf8').toString('base64url')
}

/** 没有翻页标记时从头读。标记写坏了是 400 VALIDATION_FAILED，与其它参数错误同一个码。 */
export function decodeListCursor(raw: string | undefined): ListPosition | null {
  if (raw === undefined || raw === '') return null
  const text = /^[A-Za-z0-9_-]{1,200}$/.test(raw) ? Buffer.from(raw, 'base64url').toString('utf8') : ''
  const match = /^(\d{1,15})\.(print|service)\.([A-Za-z0-9_-]{1,80})$/.exec(text)
  if (!match) {
    throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: 'cursor: invalid' } })
  }
  return { at: new Date(Number(match[1])), kind: match[2] as InvoiceOrderKind, id: match[3]! }
}

/** 全序比较：负数表示 left 排在 right 前面（更新）。 */
export function compareListPosition(left: ListPosition, right: ListPosition): number {
  const byTime = right.at.getTime() - left.at.getTime()
  if (byTime !== 0) return byTime
  if (left.kind !== right.kind) return left.kind === 'service' ? -1 : 1
  if (left.id === right.id) return 0
  return left.id > right.id ? -1 : 1
}

/** 某一种类里排在 position 之后的行（更旧）。 */
export function afterPositionWhere(kind: InvoiceOrderKind, position: ListPosition | null): Record<string, unknown> {
  if (!position) return {}
  const sameKindTail = { OR: [{ createdAt: { lt: position.at } }, { createdAt: position.at, id: { lt: position.id } }] }
  if (kind === position.kind) return sameKindTail
  // 同一时刻服务单排在打印单前面：位置在服务单上时，这一刻的打印单都在后面；位置在打印单上时，这一刻的服务单都在前面。
  return kind === 'print' ? { createdAt: { lte: position.at } } : { createdAt: { lt: position.at } }
}

/**
 * 两种各读了一批（每种最多 chunk 行，已按全序排好）。若某种读满了，它后面可能还有行没读到，
 * 合并时只能用到那一种最后一行为止，再往后会漏掉夹在中间的行。返回这次能放心用的行，以及后面还有没有。
 */
export function mergeListChunks<T extends ListPosition>(prints: T[], services: T[], chunk: number): { rows: T[]; more: boolean } {
  const frontiers = [prints.length >= chunk ? prints.at(-1) : undefined, services.length >= chunk ? services.at(-1) : undefined]
    .filter((row): row is T => row !== undefined)
  const merged = [...prints, ...services].sort(compareListPosition)
  const rows = merged.filter((row) => frontiers.every((frontier) => compareListPosition(row, frontier) <= 0))
  return { rows, more: frontiers.length > 0 }
}
