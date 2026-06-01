// ============================================================
// PrintJobs Controller — W6
//
// Kiosk-facing endpoints (no auth — Kiosk is a controlled device).
//
// Routes (all prefixed with /api/v1):
//   POST  /print/jobs          — Kiosk submits a new print job
//   GET   /print/jobs/:taskId  — Kiosk polls task status
// ============================================================

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { PrintJobsService } from './print-jobs.service'
import { CreatePrintJobDto } from './dto/create-print-job.dto'

@Controller('print/jobs')
export class PrintJobsController {
  constructor(private readonly service: PrintJobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePrintJobDto) {
    return this.service.create(dto)
  }

  @Get(':taskId')
  getStatus(@Param('taskId') taskId: string) {
    return this.service.getStatus(taskId)
  }
}
