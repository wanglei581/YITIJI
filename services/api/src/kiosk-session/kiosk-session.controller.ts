import { Controller, Post } from '@nestjs/common'

@Controller('kiosk/session')
export class KioskSessionController {
  @Post('heartbeat')
  async heartbeat() {
    return { ok: true }
  }

  @Post('extend')
  async extend() {
    return { ok: true }
  }
}
