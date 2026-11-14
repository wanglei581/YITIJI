import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecruitmentHostingNotice } from './RecruitmentHostingNotice'
import type { RecruitmentHostingView } from './useRecruitmentHosting'

const NAME = '示例职业介绍所'
const LICENSE = '鲁人社证字〔2026〕第001号'
const EXACT = `运营单位自报：${NAME}，人力资源服务许可证编号 ${LICENSE}。本软件未核验。`

function ready(operatorSelfReport: { name: string; licenseNumber: string } | null): RecruitmentHostingView {
  return {
    status: 'ready',
    enabled: true,
    writable: true,
    operatorSelfReport,
    retry() {},
  }
}

function markup(hosting: RecruitmentHostingView): string {
  return renderToStaticMarkup(createElement(RecruitmentHostingNotice, { hosting, subject: '岗位' }))
}

test('有自报内容时提示条逐字出现，且不出现已认证、已核验', () => {
  const html = markup(ready({ name: NAME, licenseNumber: LICENSE }))
  assert.ok(html.includes(EXACT), html)
  assert.ok(html.includes('运营单位自报：'), html)
  assert.ok(html.includes('本软件未核验。'), html)
  assert.equal(html.includes('已认证'), false, html)
  assert.equal(html.includes('已核验'), false, html)
})

test('自报为空时提示条不出现', () => {
  const html = markup(ready(null))
  assert.equal(html, '')
  assert.equal(html.includes('运营单位自报：'), false)
  assert.equal(html.includes('本软件未核验。'), false)
})
