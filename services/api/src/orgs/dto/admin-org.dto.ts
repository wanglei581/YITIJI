import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * Admin 合作机构管理 DTO(阶段1B)。
 *
 * 契约源:packages/shared/src/types/partner.ts(PartnerType / SceneTemplate / EnabledModule)。
 * services/api 是 CommonJS,无法 import 共享包 → 本地副本,改动须两处同步。
 *
 * 合规:机构只做"外部数据来源方 + 运营协作方";不存在企业招聘端账号概念。
 * 启用模块白名单由 service 层再校验一次(招聘闭环模块硬拒绝)。
 */

export const PARTNER_TYPES = [
  'school_employment_center',
  'public_employment_service',
  'licensed_hr_agency',
  'fair_organizer',
  'enterprise_source',
] as const

export const SCENE_TEMPLATES = ['school', 'public_employment', 'licensed_hr_service'] as const

export class OrgAccountInputDto {
  @IsString() @IsNotEmpty() @MinLength(3) @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username 只允许字母数字及 _.-' })
  username!: string

  @IsString() @MinLength(8) @MaxLength(72)
  password!: string

  @IsString() @IsNotEmpty() @MaxLength(50)
  name!: string
}

export class CreateOrgDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string

  @IsIn([...PARTNER_TYPES])
  type!: string

  @IsOptional() @IsString() @MaxLength(200)
  contact?: string

  @IsOptional() @IsString() @MaxLength(50)
  contactPhone?: string

  @IsOptional() @IsIn([...SCENE_TEMPLATES])
  sceneTemplate?: string

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true })
  enabledModules?: string[]

  /** 可选:创建机构时同时开通首个 partner 登录账号。 */
  @IsOptional() @ValidateNested() @Type(() => OrgAccountInputDto)
  account?: OrgAccountInputDto
}

export class UpdateOrgDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string

  @IsOptional() @IsIn([...PARTNER_TYPES])
  type?: string

  @IsOptional() @IsString() @MaxLength(200)
  contact?: string

  @IsOptional() @IsString() @MaxLength(50)
  contactPhone?: string

  @IsOptional() @IsIn([...SCENE_TEMPLATES])
  sceneTemplate?: string

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true })
  enabledModules?: string[]
}

export class OrgStatusDto {
  @IsIn(['enable', 'disable'])
  action!: 'enable' | 'disable'
}

export class AccountStatusDto {
  @IsIn(['enable', 'disable'])
  action!: 'enable' | 'disable'
}

export class ResetAccountPasswordDto {
  @IsString() @MinLength(8) @MaxLength(72)
  password!: string
}
