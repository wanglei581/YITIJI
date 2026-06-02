import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  ValidateNested,
  Matches,
  MaxLength,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * 打印参数强校验 DTO（收口版）。
 *
 * 与 packages/shared 的 PrintJobParams 对齐，但只接受本阶段**真实支持/暴露**的参数，
 * 配合 main.ts 的 ValidationPipe（whitelist + forbidNonWhitelisted）：
 *   - 非法枚举值 / 越界 copies / 非法 pageRange → 400 VALIDATION_FAILED
 *   - 未声明的扩展字段（collate/paperType/feeder 等）→ 400（不静默接收）
 *
 * 说明：quality / pagesPerSheet 当前前端已隐藏（Agent 暂不生效），但仍以安全默认值
 * 上送，故此处保留并做枚举校验（不接受非法值）。
 */
export class PrintJobParamsDto {
  @IsInt()
  @Min(1)
  @Max(99)
  copies!: number

  @IsIn(['black_white', 'color'])
  colorMode!: 'black_white' | 'color'

  @IsIn(['simplex', 'duplex_long_edge', 'duplex_short_edge'])
  duplex!: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'

  /** CM2800ADN/CM2820ADN 系列仅支持 A4。 */
  @IsIn(['A4'])
  paperSize!: 'A4'

  @IsIn(['auto', 'portrait', 'landscape'])
  orientation!: 'auto' | 'portrait' | 'landscape'

  @IsIn(['draft', 'standard', 'high'])
  quality!: 'draft' | 'standard' | 'high'

  @IsIn(['fit', 'actual'])
  scale!: 'fit' | 'actual'

  @IsIn([1, 2, 4])
  pagesPerSheet!: 1 | 2 | 4

  /** undefined = all pages；自定义如 '1-3,5,7-9'（仅数字/逗号/连字符/空格）。 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/, {
    message: 'pageRange 格式非法，应如 "1-3,5,7-9"',
  })
  pageRange?: string
}

export class CreatePrintJobDto {
  @IsString()
  @IsNotEmpty()
  fileUrl!: string

  /**
   * 文件哈希（hex）。方案②：wire 字段名保留 `fileMd5`，但当前承载 **SHA-256**
   * （files 服务计算 sha256 → Kiosk 原样上送）。Agent 用 SHA-256 比对。
   * 缺省时 Terminal Agent 跳过完整性校验。
   */
  @IsString()
  @IsOptional()
  @MaxLength(128)
  fileMd5?: string

  /** 原始文件名（用于任务详情/审计；当前无独立列，落在 paramsJson 内，见 service）。 */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  fileName?: string

  /** 打印参数——强类型嵌套校验，拒绝非法值与未知字段。 */
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintJobParamsDto)
  params?: PrintJobParamsDto
}
