import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator'
import { BULK_PUBLISH_MAX_BATCH, type BulkPublishKind } from '../bulk-publish.service'

const KINDS: BulkPublishKind[] = ['job', 'fair', 'policy']

export class BulkPublishPreviewDto {
  @IsIn(KINDS)
  kind!: BulkPublishKind

  /** 按来源机构筛选 */
  @IsOptional()
  @IsString()
  sourceOrgId?: string

  /** 同步时间下界(含) */
  @IsOptional()
  @IsISO8601()
  syncTimeFrom?: string

  /** 同步时间上界(含) */
  @IsOptional()
  @IsISO8601()
  syncTimeTo?: string
}

export class BulkPublishExecuteDto {
  @IsIn(KINDS)
  kind!: BulkPublishKind

  /**
   * 必须是显式 id 列表(来自 preview),不接受「按条件全发」。
   * 上限与 preview 的 batchLimit 一致;超出由服务层返回 BULK_BATCH_TOO_LARGE。
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_PUBLISH_MAX_BATCH)
  @IsString({ each: true })
  ids!: string[]
}
