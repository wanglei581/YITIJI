import { Controller, Get, Param } from '@nestjs/common'

@Controller('kiosk/legal')
export class LegalController {
  @Get(':type')
  async findOne(@Param('type') type: string) {
    return { type, content: '', version: '1.0' }
  }
}
