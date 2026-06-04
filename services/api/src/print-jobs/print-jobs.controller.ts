// ============================================================
// PrintJobs Controller — W7
//
// Kiosk-facing endpoints (no auth — Kiosk is a controlled device).
//
// Routes (all prefixed with /api/v1):
//   POST  /print/jobs          — Kiosk submits a new print job (rate-limited: 10/min per IP)
//   GET   /print/jobs/:taskId  — Kiosk polls task status
// ============================================================

import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { PrintJobsService } from './print-jobs.service'
import { CreatePrintJobDto } from './dto/create-print-job.dto'

@Controller('print/jobs')
export class PrintJobsController {
  constructor(private readonly service: PrintJobsService) {}

  // 鉴权取舍（HIGH-3）：本端点服务匿名 Kiosk 上传打印流程，加 JWT/设备鉴权会破坏
  // 一体机匿名打印，故采用「强校验签名 fileUrl（验签+有效期，SSRF 防护）+ IP 限流
  // （10/min）+ 全量审计」组合。fileUrl 必须由本系统 files 服务签发，外部 URL 一律 400。
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(
    @Body() dto: CreatePrintJobDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.service.create(dto, { ipAddress: ip ?? null, userAgent: userAgent ?? null })
  }

  @Get(':taskId')
  getStatus(@Param('taskId') taskId: string) {
    return this.service.getStatus(taskId)
  }
}
