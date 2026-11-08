import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiResponse } from '../common/dto/api-response.dto'
import { TerminalsService } from '../terminals/terminals.service'
import { CopyAgentService } from './copy-agent.service'
import { CopyPrintResultDto, CopyScanResultDto } from './copy-job.dto'

/** 与 current-lease/device-report 相同：Agent Bearer 在控制器校验，服务内再核单归属。 */
@Controller('terminals/:terminalId/copy/jobs/:id')
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class CopyAgentController {
  constructor(private readonly agent: CopyAgentService, private readonly terminals: TerminalsService) {}

  @Get('permit')
  async permit(@Param('terminalId') terminalId: string, @Param('id') id: string,
    @Query('op') op: string, @Headers('authorization') auth?: string) {
    await this.terminals.assertAgentAuthorized(terminalId, auth)
    return ApiResponse.ok(await this.agent.permit(terminalId, id, op))
  }

  @Post('scan-result')
  @HttpCode(200)
  async scanResult(@Param('terminalId') terminalId: string, @Param('id') id: string,
    @Body() dto: CopyScanResultDto, @Headers('authorization') auth?: string) {
    await this.terminals.assertAgentAuthorized(terminalId, auth)
    return ApiResponse.ok(await this.agent.scanResult(terminalId, id, dto))
  }

  @Post('result')
  @HttpCode(200)
  async result(@Param('terminalId') terminalId: string, @Param('id') id: string,
    @Body() dto: CopyPrintResultDto, @Headers('authorization') auth?: string) {
    await this.terminals.assertAgentAuthorized(terminalId, auth)
    return ApiResponse.ok(await this.agent.result(terminalId, id, dto))
  }
}
