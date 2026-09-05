import { Controller, HttpCode, HttpStatus, NotImplementedException, Post } from '@nestjs/common'

/**
 * 一体机会话记账尚未实现（KioskSession 表零写入是已知缺口）。
 * 前端不调用本控制器；隐私清场走本地 idle timer。
 * 假成功会违反 CLAUDE.md §9，因此明确 501，保留模块便于以后接真写入。
 */
@Controller('kiosk/session')
export class KioskSessionController {
  @Post('heartbeat')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  heartbeat(): never {
    throw new NotImplementedException({
      error: {
        code: 'KIOSK_SESSION_NOT_IMPLEMENTED',
        message: '一体机会话记账尚未实现，本端点不会记录服务人次',
      },
    })
  }

  @Post('extend')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  extend(): never {
    throw new NotImplementedException({
      error: {
        code: 'KIOSK_SESSION_NOT_IMPLEMENTED',
        message: '一体机会话记账尚未实现，本端点不会延长会话',
      },
    })
  }
}
