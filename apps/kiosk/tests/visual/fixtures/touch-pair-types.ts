import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'

export type PairItem = '打印' | '简历' | '面试' | '政策' | '扫描' | '状态样式板'
export type PairStatus = 'paired' | 'runtime-missing' | 'draft-missing'

export interface TouchPair {
  item: PairItem
  screen: string
  state: string
  /** 运行页路由。造不出来时仍写下本来要去的路由，原因放 missingReason。 */
  route: string | null
  seeds: string[]
  /** 非空：不打开运行页，记 runtime-missing。 */
  missingReason: string | null
  proto?: {
    query?: Record<string, string>
    /** 进屏 1300ms 之后写进 window.S，再 refresh。 */
    patch?: Record<string, unknown>
  }
  prepare?: (page: Page, api: ApiRouter) => Promise<void>
  /** Playwright 选择器。准备完必须看见，否则这对记 runtime-missing。 */
  ready?: string
}

export interface RuntimeMetrics {
  taps: number
  minFontPx: number | null
  blankBandPx: number
  blankAtY: number
}

export interface ProtoMeasure {
  taps: number
  small: number
  pct: number
  minFs: number | string
}
