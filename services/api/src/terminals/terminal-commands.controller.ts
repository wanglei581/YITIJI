import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { AckTerminalCommandDto } from './dto/ack-terminal-command.dto'
import { TerminalCommandService, type TerminalCommandAckResult } from './terminal-commands.service'

@Controller()
export class TerminalCommandsController {
  constructor(private readonly commands: TerminalCommandService) {}

  @Post('terminals/:terminalId/commands/:commandId/ack')
  @HttpCode(HttpStatus.OK)
  async ack(
    @Param('terminalId') terminalId: string,
    @Param('commandId') commandId: string,
    @Body() dto: AckTerminalCommandDto,
    @Headers('authorization') auth: string | undefined,
  ): Promise<ApiResponse<{ result: TerminalCommandAckResult }>> {
    return ApiResponse.ok(await this.commands.ack(
      terminalId,
      commandId,
      { result: dto.result, remainingJobs: dto.remainingJobs },
      auth,
    ))
  }
}
