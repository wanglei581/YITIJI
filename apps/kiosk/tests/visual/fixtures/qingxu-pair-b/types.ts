// B 路每页一个夹具对象。ResumePagesPlan 与 PolicyPagesPlan 同形。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import type { QingxuPairTarget, RuntimePlan } from '../qingxu-pair-targets'

export interface ResumePagesPlan {
  plan: RuntimePlan
  reason: string | null
  marker: string | null
  runtimePath: string | null
  /** 截原稿前写入的 sessionStorage。值已是字符串，稿用它落到真实态，而不是拦截态。 */
  protoStorage?: Record<string, string>
}

export interface ResumePageExtraPair {
  screen: string
  state: string
  route: string
  protoQuery: string
}

export interface ResumePageFixture {
  prefix: string
  plan(screen: string, state: string): ResumePagesPlan | null
  prepare?(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void>
  extraPairs?(): ResumePageExtraPair[]
}
