import 'reflect-metadata'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CronExpression, ScheduleModule } from '@nestjs/schedule'
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants'
import { AppModule } from '../../app.module'
import { MaterialsCleanupTask } from '../../materials/materials.cleanup.task'
import { ScanTaskReaperTask } from '../../scan-tasks/scan-task-reaper.task'
import { FilesCleanupTask } from '../files.cleanup.task'
import { FilesModule } from '../files.module'

const EVERY_MINUTE = '*/1 * * * *'
const EVERY_HOUR = '0 0-23/1 * * *'

function cronTimeOf(type: { prototype: Record<string, unknown> }, method: string): unknown {
  const handler = type.prototype[method]
  assert.equal(typeof handler, 'function', `${type.name}.${method} 不是方法`)
  const options = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, handler) as { cronTime?: unknown } | undefined
  assert.ok(options, `${type.name}.${method} 没有定时元数据`)
  return options.cronTime
}

test('三个清理任务的定时方法和间隔都还在', () => {
  assert.equal(CronExpression.EVERY_MINUTE, EVERY_MINUTE)
  assert.equal(CronExpression.EVERY_HOUR, EVERY_HOUR)
  assert.equal(cronTimeOf(FilesCleanupTask, 'handleEveryMinute'), EVERY_MINUTE)
  assert.equal(cronTimeOf(FilesCleanupTask, 'handleHourly'), EVERY_HOUR)
  assert.equal(cronTimeOf(MaterialsCleanupTask, 'handleHourly'), EVERY_HOUR)
  assert.equal(cronTimeOf(ScanTaskReaperTask, 'reapStuckMatched'), EVERY_MINUTE)
  assert.equal(cronTimeOf(ScanTaskReaperTask, 'reapUnackedWaiting'), EVERY_MINUTE)
  assert.equal(cronTimeOf(ScanTaskReaperTask, 'reapExpiredWaiting'), EVERY_MINUTE)
})

test('FilesModule 提供 FilesCleanupTask，AppModule 引入 ScheduleModule', () => {
  const providers = Reflect.getMetadata('providers', FilesModule) as unknown[]
  assert.ok(Array.isArray(providers), 'FilesModule 没有 providers 元数据')
  assert.ok(providers.includes(FilesCleanupTask), 'FilesModule.providers 里没有 FilesCleanupTask')

  const imports = Reflect.getMetadata('imports', AppModule) as unknown[]
  assert.ok(Array.isArray(imports), 'AppModule 没有 imports 元数据')
  const hasSchedule = imports.some((item) => {
    if (item === ScheduleModule) return true
    return Boolean(item && typeof item === 'object' && (item as { module?: unknown }).module === ScheduleModule)
  })
  assert.equal(hasSchedule, true)
})
