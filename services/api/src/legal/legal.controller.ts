import { BadRequestException, Controller, Get, Param } from '@nestjs/common'
import { LegalService, LEGAL_DOC_TYPES, type LegalDocType } from './legal.service'

@Controller('kiosk/legal')
export class LegalController {
  constructor(private readonly service: LegalService) {}

  /** GET /api/v1/kiosk/legal/:type — 返回当前有效版本内容（无鉴权） */
  @Get(':type')
  async getActive(@Param('type') type: string) {
    if (!LEGAL_DOC_TYPES.includes(type as LegalDocType)) {
      throw new BadRequestException({
        error: { code: 'LEGAL_DOC_TYPE_INVALID', message: '法务文档类型不支持' },
      })
    }
    const doc = await this.service.getActive(type as LegalDocType)
    return { success: true, data: doc }
  }
}
