// 触屏稿 ↔ 一体机运行页并排截图。按需跑，不进 CI。
// TOUCH_PAIRS_PORT=7471 pnpm --filter @ai-job-print/kiosk exec playwright test --config=playwright.touch-pairs.config.ts
// 稿服务固定 7472。可用 --grep 只跑某一项（打印 / 简历 / 面试 / 政策 / 扫描 / 状态样式板）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'
import { captureItem, listenProto, previewOrigin } from './fixtures/touch-pair-capture'
import { interviewPairs } from './fixtures/touch-pair-interview'
import { policyPairs } from './fixtures/touch-pair-policy'
import { printPairs } from './fixtures/touch-pair-print'
import { resumePairs } from './fixtures/touch-pair-resume'
import { scanPairs } from './fixtures/touch-pair-scan'
import { statePairs } from './fixtures/touch-pair-states'

const here = path.dirname(fileURLToPath(import.meta.url))
const draftRoot = path.resolve(here, '../../../../docs/design/kiosk-touch-2026-10')

let proto: { origin: string; close: () => Promise<void> }

test.beforeAll(async () => {
  proto = await listenProto(draftRoot)
})

test.afterAll(async () => {
  await proto?.close()
})

test('打印 并排', async ({ browser }) => {
  test.skip(process.env.TOUCH_PAIRS !== '1', 'on-demand capture')
  test.setTimeout(1_800_000)
  await captureItem(browser, proto.origin, previewOrigin(), printPairs())
})

test('简历 并排', async ({ browser }) => {
  test.skip(process.env.TOUCH_PAIRS !== '1', 'on-demand capture')
  test.setTimeout(1_800_000)
  await captureItem(browser, proto.origin, previewOrigin(), resumePairs())
})

test('面试 并排', async ({ browser }) => {
  test.skip(process.env.TOUCH_PAIRS !== '1', 'on-demand capture')
  test.setTimeout(1_800_000)
  await captureItem(browser, proto.origin, previewOrigin(), interviewPairs())
})

test('政策 并排', async ({ browser }) => {
  test.skip(process.env.TOUCH_PAIRS !== '1', 'on-demand capture')
  test.setTimeout(1_800_000)
  await captureItem(browser, proto.origin, previewOrigin(), policyPairs())
})

test('扫描 并排', async ({ browser }) => {
  test.skip(process.env.TOUCH_PAIRS !== '1', 'on-demand capture')
  test.setTimeout(1_800_000)
  await captureItem(browser, proto.origin, previewOrigin(), scanPairs())
})

test('状态样式板 并排', async ({ browser }) => {
  test.skip(process.env.TOUCH_PAIRS !== '1', 'on-demand capture')
  test.setTimeout(1_800_000)
  await captureItem(browser, proto.origin, previewOrigin(), statePairs())
})
