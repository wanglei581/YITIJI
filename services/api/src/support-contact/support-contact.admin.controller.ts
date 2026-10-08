import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { UpdateSupportContactDto } from './dto/update-support-contact.dto'
import { SupportContactService, type SupportContactPatch } from './support-contact.service'

@Controller('admin/support-contact')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SupportContactAdminController {
  constructor(private readonly service: SupportContactService) {}

  @Get()
  async get() {
    return { success: true as const, data: await this.service.getAdmin() }
  }

  @Put()
  async update(
    @Body() dto: UpdateSupportContactDto,
    @Req() req: Request,
    @CurrentUser() user: AuthedUser,
  ) {
    const raw = req.body
    const patch: SupportContactPatch = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const body = raw as Record<string, unknown>
      if (Object.prototype.hasOwnProperty.call(body, 'servicePhone')) patch.servicePhone = dto.servicePhone ?? null
      if (Object.prototype.hasOwnProperty.call(body, 'serviceHours')) patch.serviceHours = dto.serviceHours ?? null
      if (Object.prototype.hasOwnProperty.call(body, 'miniappPublished')) patch.miniappPublished = dto.miniappPublished
    }
    return {
      success: true as const,
      data: await this.service.updateAdmin(patch, { userId: user.userId, role: user.role }),
    }
  }
}
