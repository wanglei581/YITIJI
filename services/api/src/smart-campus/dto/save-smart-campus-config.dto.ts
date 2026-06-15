import { Type } from 'class-transformer'
import { IsBoolean, IsObject, IsOptional, ValidateNested } from 'class-validator'
import type { SmartCampusModules } from '../smart-campus.types'

export class SmartCampusModulesDto implements Partial<SmartCampusModules> {
  @IsOptional()
  @IsBoolean()
  welcome?: boolean

  @IsOptional()
  @IsBoolean()
  bigdata?: boolean

  @IsOptional()
  @IsBoolean()
  luggage?: boolean

  @IsOptional()
  @IsBoolean()
  panorama?: boolean
}

export class SaveSmartCampusConfigDto {
  @IsBoolean()
  enabled!: boolean

  /** 子模块开关位；字段缺失视为 false，传入时必须是 boolean。 */
  @IsObject()
  @ValidateNested()
  @Type(() => SmartCampusModulesDto)
  modules!: SmartCampusModulesDto
}
