import assert from 'node:assert/strict'
import test from 'node:test'
import { activityActionText, activityCategoryText, activityStatusText, activityTerminalText } from './activityDisplay.ts'

const ENGLISH = /\b(completed|active|optimize_confirmed|parse_intent|resume_upload|application\/pdf|pending_release)\b/

test('最近活动把文件、打印、AI 状态和类别写成中文', () => {
  const file = { type: 'file' as const, category: 'resume_upload:application/pdf', status: 'active', action: null }
  assert.equal(activityCategoryText(file).label, '上传简历（PDF）')
  assert.equal(activityStatusText(file).label, '上传完成')
  const print = { type: 'print' as const, category: null, status: 'pending_release', action: null }
  assert.equal(activityStatusText(print).label, '待到机')
  assert.equal(activityStatusText({ ...print, status: 'completed' }).label, '已完成')
  assert.equal(activityCategoryText({ type: 'ai', category: 'optimize_confirmed', status: 'completed', action: null }).label, '简历优化确认稿')
  assert.equal(activityCategoryText({ type: 'ai', category: 'parse_intent', status: 'completed', action: null }).label, '简历诊断提交')
  assert.equal(activityStatusText({ type: 'ai', category: 'parse_intent', status: 'unknown', action: null }).label, '结果未确认')
  assert.equal(activityActionText({ type: 'external_jump', action: 'external_apply' }).label, '打开来源投递入口')
  assert.equal(activityCategoryText({ type: 'browse', category: 'policy', status: null, action: null }).label, '政策')
})

test('最近活动可见文字不含英文枚举，终端只显示尾号', () => {
  const terminal = activityTerminalText('t_09fd272201b6588e')
  assert.equal(terminal.label, '终端（尾号 b6588e）')
  assert.equal(terminal.title, 't_09fd272201b6588e')
  assert.equal(activityTerminalText(null).label, '—')
  const visible = [
    activityCategoryText({ type: 'file', category: 'resume_upload:application/pdf', status: 'active', action: null }).label,
    activityStatusText({ type: 'file', category: 'resume_upload:application/pdf', status: 'active', action: null }).label,
    activityCategoryText({ type: 'ai', category: 'optimize_confirmed', status: 'completed', action: null }).label,
    activityStatusText({ type: 'ai', category: 'optimize_confirmed', status: 'completed', action: null }).label,
    activityStatusText({ type: 'print', category: null, status: 'completed', action: null }).label,
    terminal.label,
  ].join('\n')
  assert.equal(ENGLISH.test(visible), false)
  assert.equal(visible.includes('t_'), false)
})

test('未知类别保留原值', () => {
  const text = activityCategoryText({ type: 'ai', category: 'future_kind', status: null, action: null })
  assert.equal(text.label, '未归类（future_kind）')
  assert.equal(text.title, 'future_kind')
})
