import { Controller, Get, HttpCode, HttpStatus, NotImplementedException, Param } from '@nestjs/common'

/**
 * 旧 kiosk 活动桩。真实权益活动在 /activities。
 * 前端无调用点；回显 id / 空列表会违反 CLAUDE.md §9。
 */
@Controller('kiosk/activities')
export class ActivitiesController {
  @Get()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  findAll(): never {
    throw new NotImplementedException({
      error: {
        code: 'KIOSK_ACTIVITIES_NOT_IMPLEMENTED',
        message: '此活动接口未实现；权益活动请使用 /activities',
      },
    })
  }

  @Get(':id')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  findOne(@Param('id') _id: string): never {
    throw new NotImplementedException({
      error: {
        code: 'KIOSK_ACTIVITIES_NOT_IMPLEMENTED',
        message: '此活动接口未实现，不会返回活动数据',
      },
    })
  }
}
