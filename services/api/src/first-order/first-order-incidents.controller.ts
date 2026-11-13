import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { FirstOrderIncidentsService } from './first-order-incidents.service'
import { CreateIncidentDto, UpdateIncidentDto } from './first-order-incidents.dto'
import { AdminIncidentDirectoryQuery, parseFirstOrderListLimit } from './first-order.dto'

@Controller('admin/first-order')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminFirstOrderIncidentsController {
  constructor(private readonly incidents: FirstOrderIncidentsService) {}
  @Get('incidents')
  @Header('Cache-Control', 'no-store')
  directory(@CurrentUser() user: AuthedUser, @Query() query: AdminIncidentDirectoryQuery) {
    return this.incidents.listDirectory(user, query.status, parseFirstOrderListLimit(query.limit))
  }
  @Post('incidents')
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthedUser, @Body() body: CreateIncidentDto) { return this.incidents.create(user, body) }
  @Patch('incidents/:id')
  @Header('Cache-Control', 'no-store')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: UpdateIncidentDto) {
    return this.incidents.update(user, id, body)
  }
}

@Controller('partner/first-order')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerFirstOrderIncidentsController {
  constructor(private readonly incidents: FirstOrderIncidentsService) {}
  @Post('incidents')
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthedUser, @Body() body: CreateIncidentDto) { return this.incidents.create(user, body) }
  @Patch('incidents/:id')
  @Header('Cache-Control', 'no-store')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: UpdateIncidentDto) {
    return this.incidents.update(user, id, body)
  }
}
