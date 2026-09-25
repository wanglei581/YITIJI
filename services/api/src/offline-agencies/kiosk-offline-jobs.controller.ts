// ============================================================
// KioskOfflineJobsController — 岗位详情公开端点
//
// GET /kiosk/offline-jobs/:id — 岗位详情 + 关联机构（仅已发布机构下的岗位）
// ============================================================

import { Controller, Get, Param, Req } from '@nestjs/common'
import { OfflineAgenciesService } from './offline-agencies.service'
import {
  KioskJobBoardService,
  kioskJobBoardTerminalRef,
  type KioskJobBoardRequest,
} from '../terminals/kiosk-job-board.service'

@Controller('kiosk/offline-jobs')
export class KioskOfflineJobsController {
  constructor(
    private readonly service: OfflineAgenciesService,
    private readonly jobBoard: KioskJobBoardService,
  ) {}

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: KioskJobBoardRequest) {
    await this.jobBoard.assertOpen(kioskJobBoardTerminalRef(req))
    return this.service.findOneJob(id)
  }
}
