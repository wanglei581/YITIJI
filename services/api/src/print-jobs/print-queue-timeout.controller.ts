import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PrismaService } from '../prisma/prisma.service'
import { UpdatePrintQueueTimeoutDto } from './dto/update-print-queue-timeout.dto'
import { readPrintQueueTimeoutMinutes, updatePrintQueueTimeoutMinutes } from './print-queue-timeout'

@Controller('admin/print-queue-timeout')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPrintQueueTimeoutController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get() {
    return { success: true as const, data: { minutes: await readPrintQueueTimeoutMinutes(this.prisma) } }
  }

  @Put()
  async update(@Body() dto: UpdatePrintQueueTimeoutDto, @CurrentUser() user: AuthedUser) {
    const minutes = await updatePrintQueueTimeoutMinutes(this.prisma, this.audit, dto.minutes, {
      userId: user.userId,
      role: user.role,
    })
    return { success: true as const, data: { minutes } }
  }
}
