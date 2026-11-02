import { Body, Controller, Get, Headers, Put, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { UpdatePrintFreeQuotaDto } from './dto/update-print-free-quota.dto'
import { FreePrintQuotaService } from './free-print-quota.service'

@Controller('kiosk/print-quota')
export class KioskPrintQuotaController {
  constructor(
    private readonly quota: FreePrintQuotaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @UseGuards(TerminalIdentityGuard)
  async get(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ) {
    const endUser = await resolveOptionalEndUser(authorization, this.jwt, this.redis, this.prisma)
    return {
      success: true as const,
      data: await this.quota.kioskView(terminalId?.trim() || '', endUser?.endUserId ?? null),
    }
  }
}

@Controller('admin/print-free-quota')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPrintFreeQuotaController {
  constructor(private readonly quota: FreePrintQuotaService) {}

  @Get()
  async get() {
    return { success: true as const, data: await this.quota.getAdmin() }
  }

  @Put()
  async update(@Body() dto: UpdatePrintFreeQuotaDto, @CurrentUser() user: AuthedUser) {
    return {
      success: true as const,
      data: await this.quota.updateAdmin(dto, { userId: user.userId, role: user.role }),
    }
  }
}
