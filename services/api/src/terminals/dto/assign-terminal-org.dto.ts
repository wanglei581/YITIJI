import { IsString, ValidateIf } from 'class-validator'

/**
 * Admin 终端归属变更入参。
 *
 * orgId 可为：
 *   - string：绑定到该机构（service 层再校验存在且 enabled）
 *   - null：  解绑（终端不归属任何机构）
 *
 * ValidateIf 跳过 null 的 @IsString 校验，但属性仍在 whitelist 内，
 * 故 `{ orgId: null }` 与 `{ orgId: "org-..." }` 都能通过 forbidNonWhitelisted。
 */
export class AssignTerminalOrgDto {
  @ValidateIf((o: AssignTerminalOrgDto) => o.orgId !== null)
  @IsString()
  orgId!: string | null
}
