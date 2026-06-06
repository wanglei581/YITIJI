import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'

export const MATERIAL_TASK_KINDS = [
  'inspection',
  'normalize_a4',
  'pii_scan',
  'pii_redact',
  'bundle_render',
] as const

export type MaterialTaskKind = typeof MATERIAL_TASK_KINDS[number]

/**
 * 创建材料处理任务。
 *
 * params 允许携带本期模拟扫描需要的 textSample,但 service 会在落库前移除
 * 完整原文,只保留长度等非原文元数据。
 */
export class CreateMaterialTaskDto {
  @IsIn(MATERIAL_TASK_KINDS)
  kind!: MaterialTaskKind

  @IsString()
  @IsNotEmpty()
  sourceFileId!: string

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>
}
