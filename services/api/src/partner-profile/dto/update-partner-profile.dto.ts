import { IsString, IsNotEmpty, IsOptional, IsEmail, MaxLength, Matches, ValidateIf } from 'class-validator'

/**
 * 合作机构资料更新（partner 编辑本机构）。
 *
 * 校验：机构名称 / 联系人 / 联系电话必填；邮箱、官网链接若填写则校验格式；简介限长。
 * type（机构类型）/ enabled（合作状态）不在此 DTO —— 由管理员维护，partner 不可改。
 * 沿用 class-validator（项目既有），不引入新表单依赖。
 */
export class UpdatePartnerProfileDto {
  @IsString()
  @IsNotEmpty({ message: '机构名称必填' })
  @MaxLength(100)
  name!: string

  @IsString()
  @IsNotEmpty({ message: '联系人必填' })
  @MaxLength(50)
  contactName!: string

  @IsString()
  @IsNotEmpty({ message: '联系电话必填' })
  @MaxLength(30)
  contactPhone!: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  creditCode?: string

  // 邮箱：仅在非空时校验格式（undefined / '' 跳过）
  @ValidateIf((o) => o.contactEmail !== undefined && o.contactEmail !== null && o.contactEmail !== '')
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(120)
  contactEmail?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '机构简介不超过 500 字' })
  description?: string

  // 官网链接：仅在非空时校验需以 http(s):// 开头
  @ValidateIf((o) => o.websiteUrl !== undefined && o.websiteUrl !== null && o.websiteUrl !== '')
  @Matches(/^https?:\/\/.+/, { message: '官网链接需以 http:// 或 https:// 开头' })
  @MaxLength(200)
  websiteUrl?: string
}
