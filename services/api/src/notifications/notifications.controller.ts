import { Controller, Get, HttpCode, HttpStatus, NotImplementedException, Param, Patch } from '@nestjs/common'

/**
 * 旧 kiosk 通知桩。真实会员通知在 /me/notifications。
 * 前端无调用点；假成功/空未读会违反 CLAUDE.md §9。
 */
@Controller('kiosk/notifications')
export class NotificationsController {
  @Get()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  findAll(): never {
    throw new NotImplementedException({
      error: {
        code: 'KIOSK_NOTIFICATIONS_NOT_IMPLEMENTED',
        message: '此通知接口未实现；会员通知请使用 /me/notifications',
      },
    })
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  markRead(@Param('id') _id: string): never {
    throw new NotImplementedException({
      error: {
        code: 'KIOSK_NOTIFICATIONS_NOT_IMPLEMENTED',
        message: '此通知接口未实现，不会标记已读',
      },
    })
  }
}
