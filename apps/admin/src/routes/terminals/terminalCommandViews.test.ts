import assert from 'node:assert/strict'
import test from 'node:test'
import { commandStatusView, commandTypeLabel, remoteCommandBlockReason } from './terminalCommandViews.ts'

const base = { type: 'restart_agent', completedVerified: null, resultCode: null, remainingJobs: null }

test('七种状态逐一中文化，未知状态不露原码', () => {
  const cases: Array<[string, string]> = [
    ['pending', '待执行'],
    ['accepted', '已接受'],
    ['completed', '已完成'],
    ['done', '已清空'],
    ['failed', '失败'],
    ['rejected_busy', '终端忙，稍后再试'],
    ['expired', '已过期'],
    ['something_new', '状态未知'],
  ]
  for (const [status, label] of cases) {
    assert.equal(commandStatusView({ ...base, status }).label, label, status)
  }
})

test('重启完成但没核实到新启动时间，要说明未核实', () => {
  assert.equal(commandStatusView({ ...base, status: 'completed', completedVerified: false }).label, '已完成（未核实是否重启）')
  assert.equal(commandStatusView({ ...base, status: 'completed', completedVerified: true }).label, '已完成')
})

test('两种特殊失败：清空队列剩余作业数、重启后没回来', () => {
  assert.equal(commandStatusView({ ...base, type: 'clear_print_queue', status: 'failed', remainingJobs: 2 }).label, '失败，还剩 2 个作业')
  assert.equal(commandStatusView({ ...base, type: 'clear_print_queue', status: 'failed', remainingJobs: 0 }).label, '失败，还剩 0 个作业')
  assert.equal(commandStatusView({ ...base, type: 'restart_agent', status: 'failed', remainingJobs: 3 }).label, '失败')
  assert.equal(commandStatusView({ ...base, status: 'failed', resultCode: 'no_heartbeat_after_restart' }).label, '失败，重启后终端没有回来')
})

test('命令中文名，未知类型不露原码', () => {
  assert.equal(commandTypeLabel('restart_agent'), '重启终端程序')
  assert.equal(commandTypeLabel('clear_print_queue'), '清空打印队列')
  assert.equal(commandTypeLabel('reboot_os'), '其他远程命令')
})

test('下发前置：停用或非运行中不能下发；有未结束命令也不能', () => {
  assert.equal(remoteCommandBlockReason({ enabled: true, lifecycleStatus: 'active' }, []), null)
  assert.equal(remoteCommandBlockReason({ enabled: false, lifecycleStatus: 'active' }, []), '终端不在运营中，不能下发')
  for (const lifecycleStatus of ['planned', 'commissioning', 'maintenance', 'suspended', 'retired']) {
    assert.equal(remoteCommandBlockReason({ enabled: true, lifecycleStatus }, []), '终端不在运营中，不能下发', lifecycleStatus)
  }
  for (const status of ['pending', 'accepted']) {
    assert.equal(remoteCommandBlockReason({ enabled: true, lifecycleStatus: 'active' }, [{ status }]), '上一条命令还没结束', status)
  }
  for (const status of ['completed', 'done', 'failed', 'rejected_busy', 'expired']) {
    assert.equal(remoteCommandBlockReason({ enabled: true, lifecycleStatus: 'active' }, [{ status }]), null, status)
  }
})
