import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

/** 对账报表查询（可选时间窗；不传则全量）。 */
export class AdminReconciliationQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string

  @IsOptional()
  @IsISO8601()
  to?: string
}

/**
 * Admin 改价请求体（W-C 计费配置）。
 * - 只允许更新**已存在**的价目项（本波不开放新建：新增计费项须随对应业务闭环评审落地）。
 * - `unitCents` 整数「分」，0 ~ 1_000_000（0 元合法=该项免费；上限防手滑天价）。
 * - 三字段全可选，但至少携带一个（服务层校验 PRICE_PATCH_EMPTY）。
 */
export class AdminUpdatePriceConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  unitCents?: number

  /** 0 元会绕过收银，必须由管理员的二次确认显式提交。 */
  @IsOptional()
  @IsBoolean()
  confirmZeroPrice?: boolean

  @IsOptional()
  @IsBoolean()
  active?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string
}
