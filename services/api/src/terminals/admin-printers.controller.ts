import { Controller, Get, Logger, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { TerminalsService, type AdminPrinterView } from './terminals.service'
import {
  AdminPrinterOutputService,
  type AdminPrinterOutput,
} from './admin-printer-output'

type AdminPrinterList = {
  printers: Array<AdminPrinterView & { output: AdminPrinterOutput | null }>
  outputStatus: 'ok' | 'capped' | 'unavailable'
}

const EMPTY_OUTPUT: AdminPrinterOutput = {
  today: { sides: 0, colorSides: 0, duplexSides: 0 },
  month: { sides: 0, colorSides: 0, duplexSides: 0 },
  monthUnconfirmedTasks: 0,
}

@Controller('admin/printers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPrintersController {
  private readonly logger = new Logger(AdminPrintersController.name)

  constructor(
    private readonly terminalsService: TerminalsService,
    private readonly printerOutput: AdminPrinterOutputService,
  ) {}

  @Get()
  async list(): Promise<ApiResponse<AdminPrinterList>> {
    const listed = await this.terminalsService.listPrintersForAdmin()
    try {
      const summary = await this.printerOutput.summarize(listed.printers.map((printer) => printer.terminalId))
      if (summary.status === 'capped') {
        return ApiResponse.ok({
          printers: listed.printers.map((printer) => ({ ...printer, output: null })),
          outputStatus: 'capped',
        })
      }
      return ApiResponse.ok({
        printers: listed.printers.map((printer) => ({
          ...printer,
          output: summary.byTerminal.get(printer.terminalId) ?? EMPTY_OUTPUT,
        })),
        outputStatus: 'ok',
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error'
      this.logger.warn(`admin printer output query failed (${name}); list returned without counts`)
      return ApiResponse.ok({
        printers: listed.printers.map((printer) => ({ ...printer, output: null })),
        outputStatus: 'unavailable',
      })
    }
  }
}
