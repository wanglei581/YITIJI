import type { ReactNode } from 'react'
import { MeErrorPack, MeLoadingPack, MeLoginGate, gatePageFromTitle } from '../../touch/MeStatePacks'

/**
 * 记录页的登录门、读取中、读不到三种状态，都落到触屏版的状态屏（稿 gate / loading / err）。
 * 这里只剩薄薄一层，保留各页原来的调用形状：title 只用来认出是哪一页。
 */
export function QxMeLoginBlock({
  title,
  printPick = false,
}: {
  title: string
  desc?: string
  struct?: ReactNode
  onJobs?: () => void
  onPrint?: () => void
  printPick?: boolean
}) {
  return <MeLoginGate page={gatePageFromTitle(title)} printPick={printPick} />
}

export function QxMeLoadingBlock(props: { title?: string }) {
  void props.title
  return <MeLoadingPack />
}

export function QxMeErrorBlock({ onRetry }: { title?: string; desc?: string; struct?: ReactNode; onRetry?: () => void }) {
  return <MeErrorPack onRetry={onRetry} />
}
