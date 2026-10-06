// B 路造状态登记处：16、18、19、20、21、22、23、24、25、29、34、46、52。
// 按稿文件名前缀找到那一页再转交。找不到时 plan 为 null、额外对为空、prepare 什么都不做。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import type { QingxuPairTarget } from './qingxu-pair-targets'
import type { ResumePageExtraPair, ResumePagesPlan } from './qingxu-pair-b/types'
import { page16 } from './qingxu-pair-b/p16'
import { page18 } from './qingxu-pair-b/p18'
import { page19 } from './qingxu-pair-b/p19'
import { page20 } from './qingxu-pair-b/p20'
import { page21 } from './qingxu-pair-b/p21'
import { page22 } from './qingxu-pair-b/p22'
import { page23 } from './qingxu-pair-b/p23'
import { page24 } from './qingxu-pair-b/p24'
import { page25 } from './qingxu-pair-b/p25'
import { page29 } from './qingxu-pair-b/p29'
import { page34 } from './qingxu-pair-b/p34'
import { page46 } from './qingxu-pair-b/p46'
import { page52 } from './qingxu-pair-b/p52'

const PAGES = [page16, page18, page19, page20, page21, page22, page23, page24, page25, page29, page34, page46, page52]

function pageFor(file: string) {
  return PAGES.find((item) => file.startsWith(item.prefix))
}

export function resumePagesPlan(file: string, screen: string, state: string): ResumePagesPlan | null {
  return pageFor(file)?.plan(screen, state) ?? null
}

export function resumePagesExtraPairs(file: string): ResumePageExtraPair[] {
  return pageFor(file)?.extraPairs?.() ?? []
}

export async function prepareResumePages(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  await pageFor(target.file)?.prepare?.(page, api, target)
}
