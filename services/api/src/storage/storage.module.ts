import { Global, Module } from '@nestjs/common'
import { StorageService } from './storage.service'

/**
 * 全局对象存储模块。
 *
 * @Global 使 StorageService 可被任意模块(files / content / print-jobs)直接注入,
 * 统一走 COS / 本地后端,避免各模块各自 new LocalFileStorage 造成存储后端分裂。
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
