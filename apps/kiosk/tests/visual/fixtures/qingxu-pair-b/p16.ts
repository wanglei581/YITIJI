// 稿 16：简历、面试、政策三台的 first / device-off / ai-down。
// 岗位、招聘会两台停在托管闸门后面，这里不配。default 仍走原来的 w6 夹具。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import { kioskAiCapabilityItems } from '../../../../src/pages/service-hubs/serviceHubModel'
import type { QingxuPairTarget } from '../qingxu-pair-targets'
import type { ResumePageFixture, ResumePagesPlan } from './types'

const PLAN = { kind: 'resume-pages' } as const
const HUBS = new Set(['resume', 'interview', 'policy'])
const STATES = new Set(['first', 'device-off', 'ai-down'])
const ROUTES: Record<string, string> = {
  resume: '/resume-service',
  interview: '/interview-service',
  policy: '/policy-service',
}

function markerFor(screen: string, state: string): string {
  if (state === 'ai-down') return '[data-qx-page="service-hub"][data-hub-ai="down"]'
  // 简历中心才有设备卡。等 AI 也落定，避免截到「正在确认 AI」把别的卡一起灰掉。
  if (state === 'device-off' && screen === 'resume') {
    return '[data-qx-page="service-hub"][data-hub-ai="ready"]:has([data-readiness="degraded"])'
  }
  return '[data-qx-page="service-hub"][data-hub-ai="ready"]'
}

export const page16: ResumePageFixture = {
  prefix: '16-',
  plan(screen, state): ResumePagesPlan | null {
    if (!HUBS.has(screen) || !STATES.has(state)) return null
    return {
      plan: PLAN,
      reason: null,
      marker: markerFor(screen, state),
      runtimePath: ROUTES[screen] ?? null,
    }
  },
  async prepare(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
    if (target.state === 'device-off') {
      api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
        status: 200,
        json: { isOnline: false, printerStatus: 'offline', paperLevel: 'sufficient' },
      })
    }
    if (target.state === 'ai-down') {
      api.respond('GET', '/api/v1/kiosk/ai/capabilities', {
        status: 200,
        json: { success: true, data: { items: kioskAiCapabilityItems('off') } },
      })
    }
    const route = ROUTES[target.screen]
    if (route) await page.goto(route, { waitUntil: 'domcontentloaded' })
  },
}
