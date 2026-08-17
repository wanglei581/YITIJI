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
 * 彩色 / 双面（2026-08-18 产品负责人拍板开放）：DTO 这一层只做**取值合法性**校验，
 * 「这台机器验过没有」不在 DTO 判断 —— DTO 无终端上下文。真正的准入是服务端两层门禁：
 *   第 1 层 assertVerifiedPrintParameters()：全局产品边界（N-up 仍恒拒）；
 *   第 2 层 TerminalCapabilitiesService.assertPrintParamsAllowed()：按终端 fail-closed，
 *          未登记 color_print / duplex_print 的终端一律拒绝。
 * 因此这里放开枚举**不等于**放开能力；绕过 Kiosk 直接打 API 仍会被第 2 层拦下。
 *
 * pagesPerSheet 保持 @IsIn([1])：N-up 没有厂家确认，也没有产品决策。
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

  @IsIn([1])
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
