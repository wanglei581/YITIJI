import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { ORG_CONTENT_TRUST_STATUSES } from '../admin-org-content-trust.service'

/**
 * Admin 标记机构内容信任状态（发布闸门的人工入口）。
 *
 * status='active' 时 reason 必填 —— service 层再校验一次（DTO 只能表达
 * 「可选」，「active 时必填」的条件规则由 service 兜底，两处都不缺）。
 */
export class OrgContentTrustDto {
  @IsString()
  @IsIn([...ORG_CONTENT_TRUST_STATUSES])
  status!: (typeof ORG_CONTENT_TRUST_STATUSES)[number]

  /** 核验依据：授权书 / 合同 / 公开声明编号等。会写进 AuditLog。 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
