import { BadRequestException } from '@nestjs/common'

interface CapabilitySensitivePrintParams {
  colorMode?: string
  duplex?: string
  pagesPerSheet?: number
}

/**
 * 服务端最终门禁：DTO 之外的内部调用也不能绕过当前已验证能力边界。
 * 默认参数仍是黑白/单面/每张 1 页。
 */
export function assertVerifiedPrintParameters(params?: CapabilitySensitivePrintParams): void {
  const colorMode = params?.colorMode ?? 'black_white'
  const duplex = params?.duplex ?? 'simplex'
  const pagesPerSheet = params?.pagesPerSheet ?? 1

  if (colorMode === 'black_white' && duplex === 'simplex' && pagesPerSheet === 1) return

  throw new BadRequestException({
    error: {
      code: 'PRINT_PARAMETER_NOT_VERIFIED',
      message: '当前仅支持黑白、单面、每张 1 页；彩色、双面和多页合一须完成厂家确认及 Windows 真机验收后开放',
    },
  })
}
