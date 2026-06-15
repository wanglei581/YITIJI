import { IsBoolean, IsObject } from 'class-validator'
import type { SmartCampusModules } from '../smart-campus.types'

export class SaveSmartCampusConfigDto {
  @IsBoolean()
  enabled!: boolean

  /** 子模块开关位；service 层对每个字段做 !! 强制布尔化，缺失视为 false。 */
  @IsObject()
  modules!: SmartCampusModules
}
