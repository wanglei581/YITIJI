import { Controller, Get, Param } from '@nestjs/common'
import { LegalService, LEGAL_DOC_TYPES, type LegalDocType } from './legal.service'

@Controller('kiosk/legal')
export class LegalController {
  constructor(private readonly service: LegalService) {}

  /** GET /api/v1/kiosk/legal/:type — 返回当前有效版本内容（无鉴权） */
  @Get(':type')
  async getActive(@Param('type') type: string) {
    const safeType: LegalDocType = LEGAL_DOC_TYPES.includes(type as LegalDocType)
      ? (type as LegalDocType)
      : 'terms_of_service'
    const doc = await this.service.getActive(safeType)
    return { success: true, data: doc }
  }
}
