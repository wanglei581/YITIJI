import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { CreateOfficialChannelDto, ReplaceVerifiedDomainsDto, UpdateOfficialChannelDto } from './dto/official-channel.dto'
import { OfficialChannelsService } from './official-channels.service'

@Controller()
export class OfficialChannelsController {
  constructor(private readonly channels: OfficialChannelsService) {}

  @Get('admin/orgs/:id/verified-official-domains')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async listDomains(@Param('id') id: string) {
    return ApiResponse.ok(await this.channels.listVerifiedDomains(id))
  }

  @Put('admin/orgs/:id/verified-official-domains')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async replaceDomains(
    @Param('id') id: string,
    @Body() dto: ReplaceVerifiedDomainsDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return ApiResponse.ok(await this.channels.replaceVerifiedDomains(id, dto.domains, user))
  }

  @Get('partner/official-channels')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async listOwn(@CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.channels.listForPartner(user))
  }

  @Post('partner/official-channels')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async create(@CurrentUser() user: AuthedUser, @Body() dto: CreateOfficialChannelDto) {
    return ApiResponse.ok(await this.channels.createForPartner(user, dto))
  }

  @Patch('partner/official-channels/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOfficialChannelDto,
  ) {
    return ApiResponse.ok(await this.channels.updateForPartner(user, id, dto))
  }

  /**
   * 一体机公开读取。organizationId 查询参数即使传入也不参与取数，只认终端身份。
   */
  @Get('terminals/:terminalId/official-channels')
  @UseGuards(TerminalIdentityGuard)
  async listForTerminal(
    @Param('terminalId') terminalId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    void organizationId
    return ApiResponse.ok(await this.channels.listForTerminal(terminalId))
  }
}
