import { Controller, Get, Headers, Logger, Param, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { MemberDataExportDownloadService } from './member-data-export-download.service'

@Controller('member/data-exports')
export class MemberDataExportController {
  private readonly logger = new Logger(MemberDataExportController.name)

  constructor(private readonly downloads: MemberDataExportDownloadService) {}

  @Get(':id/content')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async download(
    @Param('id') requestId: string,
    @Headers('x-member-download-ticket') ticket: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const delivery = await this.downloads.claimDownload(requestId, ticket)
    let settled = false
    response.once('finish', () => {
      if (settled) return
      settled = true
      void this.downloads.finishDownload(delivery.claimId).catch((error: unknown) => {
        this.logger.error(`Member export finish failed code=EXPORT_FINISH_FAILED errorType=${safeErrorType(error)}`)
      })
    })
    response.once('close', () => {
      if (settled) return
      settled = true
      void this.downloads.abortDownload(delivery.claimId).catch((error: unknown) => {
        this.logger.warn(`Member export abort failed code=EXPORT_ABORT_FAILED errorType=${safeErrorType(error)}`)
      })
    })
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Length', delivery.buffer.length)
    response.setHeader('Content-Disposition', 'attachment; filename="member-data-export.json"')
    response.setHeader('Cache-Control', 'no-store, private')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(delivery.buffer)
  }
}

function safeErrorType(error: unknown): string {
  const value = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : 'UnknownError'
}
