import assert from 'node:assert/strict'
import test from 'node:test'
import type { KioskToolboxItem, SaveToolboxConfigInput } from '@ai-job-print/shared'
import {
  runToolboxAction,
  saveToolboxTerminalConfig,
} from './toolboxActionState.ts'

test('published governed item can be saved because projection-only fields are dropped from the request', async () => {
  const projected = {
    key: 'app:career-helper',
    title: '职业助手',
    description: '仅供个人求职参考',
    icon: 'sparkles',
    to: '/assistant?intent=career',
    disabled: false,
    sortOrder: 9,
    placements: ['toolbox'],
    launchMode: 'internal_route',
    externalUrl: null,
    qrImageUrl: null,
    qrTargetUrl: null,
    riskLevel: 'medium',
    disclaimers: ['结果仅供个人参考。'],
  } as KioskToolboxItem & { riskLevel: string; disclaimers: string[] }
  let captured: SaveToolboxConfigInput | null = null

  const saved = await saveToolboxTerminalConfig(async (terminalId, input) => {
    captured = input
    return {
      terminalId,
      enabled: input.enabled,
      items: input.items,
      updatedAt: '2026-09-06T00:00:00.000Z',
    }
  }, 'KSK-001', true, [projected])

  assert.equal(saved.enabled, true)
  assert.equal(saved.items.length, 1)
  assert.equal('riskLevel' in captured!.items[0], false)
  assert.equal('disclaimers' in captured!.items[0], false)
  assert.deepEqual(Object.keys(captured!.items[0]).sort(), [
    'description',
    'disabled',
    'externalUrl',
    'icon',
    'key',
    'launchMode',
    'placements',
    'qrImageUrl',
    'qrTargetUrl',
    'sortOrder',
    'title',
    'to',
  ].sort())
})

test('publish 400 failure flows into the page message state with the actionable reason', async () => {
  const result = await runToolboxAction(async () => {
    throw {
      status: 400,
      code: 'TOOLBOX_PUBLISH_BLOCKED',
      message: '百宝箱微应用未通过发布门禁: host_not_active',
    }
  }, '已发布')

  assert.deepEqual(result, {
    ok: false,
    message: '目标域名尚未审核生效。',
  })
})
