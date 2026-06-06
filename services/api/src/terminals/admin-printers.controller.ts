import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { TerminalsService, type AdminPrinterView } from './terminals.service'

@Controller('admin/printers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPrintersController {
  constructor(private readonly terminalsService: TerminalsService) {}

  @Get()
  async list(): Promise<ApiResponse<{ printers: AdminPrinterView[] }>> {
    return ApiResponse.ok(await this.terminalsService.listPrintersForAdmin())
  }
}
