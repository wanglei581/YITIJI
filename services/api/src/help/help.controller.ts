import { Controller, Get } from '@nestjs/common'

@Controller('kiosk/help')
export class HelpController {
  @Get()
  async findAll() {
    return { data: [] }
  }
}
