import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeOrgEditScene } from './orgFormState'

test('PlanA-1: 存量公共就业机构缺少 sceneTemplate 时自动按机构类型补齐并保留已有模块', () => {
  const res = normalizeOrgEditScene({
    type: 'public_employment_service',
    sceneTemplate: null,
    enabledModules: ['print_scan', 'policy_service'],
  })
  assert.equal(res.sceneTemplate, 'public_employment')
  assert.deepEqual(res.enabledModules, ['print_scan', 'policy_service'])
  assert.equal(res.backfilled, true)
})

test('PlanA-1: 存量机构既缺 sceneTemplate 又无模块时一并补默认模块', () => {
  const res = normalizeOrgEditScene({
    type: 'school_employment_center',
    sceneTemplate: null,
    enabledModules: [],
  })
  assert.equal(res.sceneTemplate, 'school')
  assert.equal(res.enabledModules.includes('print_scan'), true)
  assert.equal(res.backfilled, true)
})

test('PlanA-1: 已对齐场景模板的机构原样返回且不标记补齐', () => {
  const res = normalizeOrgEditScene({
    type: 'licensed_hr_agency',
    sceneTemplate: 'licensed_hr_service',
    enabledModules: ['print_scan'],
  })
  assert.equal(res.sceneTemplate, 'licensed_hr_service')
  assert.deepEqual(res.enabledModules, ['print_scan'])
  assert.equal(res.backfilled, false)
})

test('PlanA-1: source-only 机构合法空模板不误标记补齐', () => {
  const res = normalizeOrgEditScene({
    type: 'enterprise_source',
    sceneTemplate: null,
    enabledModules: [],
  })
  assert.equal(res.sceneTemplate, null)
  assert.deepEqual(res.enabledModules, [])
  assert.equal(res.backfilled, false)
})
