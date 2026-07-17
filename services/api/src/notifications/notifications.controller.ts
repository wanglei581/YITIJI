import { Controller, Get, Param, Patch } from '@nestjs/common'

@Controller('kiosk/notifications')
export class NotificationsController {
  @Get()
  async findAll() {
    return { data: [], unreadCount: 0 }
  }

  @Patch(':id/read')
  async markRead(@Param('id') _id: string) {
    return { ok: true }
  }
}
