import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { TerminalCommandService } from './terminal-commands.service'

@Injectable()
export class TerminalCommandSweepTask {
  constructor(private readonly commands: TerminalCommandService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'terminal-command-sweep' })
  async handleEveryMinute(): Promise<void> {
    await this.commands.sweep()
  }
}
