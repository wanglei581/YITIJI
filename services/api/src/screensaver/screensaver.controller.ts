import { Controller, Get } from '@nestjs/common'

@Controller('kiosk/screensaver-content')
export class ScreensaverController {
  @Get()
  async findAll() {
    return { data: [] }
  }
}
