import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { FirstOrderProjectsService } from './first-order-projects.service'
import { FirstOrderReportsService } from './first-order-reports.service'
import { AdminFirstOrderQuery, AdminReportDirectoryQuery, CreateFirstOrderProjectDto, FirstOrderDeploymentDto, FirstOrderEmptyDto, FirstOrderMonthDto, UpdateFirstOrderProjectDto, parseFirstOrderListLimit } from './first-order.dto'

@Controller('admin/first-order')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminFirstOrderController {
  constructor(private readonly projects: FirstOrderProjectsService, private readonly reports: FirstOrderReportsService) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview(@CurrentUser() user: AuthedUser, @Query() query: AdminFirstOrderQuery) {
    return this.projects.overview(user, query.orgId)
  }
  @Post('projects')
  @Header('Cache-Control', 'no-store')
  createProject(@CurrentUser() user: AuthedUser, @Body() body: CreateFirstOrderProjectDto) {
    return this.projects.create(user, body.orgId, body)
  }
  @Patch('projects/:id')
  @Header('Cache-Control', 'no-store')
  updateProject(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: UpdateFirstOrderProjectDto) {
    return this.projects.update(user, id, body, body.version)
  }
  @Post('projects/:id/deployments')
  @Header('Cache-Control', 'no-store')
  deploy(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: FirstOrderDeploymentDto) {
    return this.projects.deploy(user, id, body.terminalId, body.locationLabel)
  }
  @Post('deployments/:id/end')
  @Header('Cache-Control', 'no-store')
  end(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() _body: FirstOrderEmptyDto) {
    return this.projects.endDeployment(user, id)
  }
  @Get('projects/:id/report-preview')
  @Header('Cache-Control', 'no-store')
  preview(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Query() query: FirstOrderMonthDto) {
    return this.reports.preview(user, id, query.month)
  }
  @Post('projects/:id/reports')
  @Header('Cache-Control', 'no-store')
  createReport(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: FirstOrderMonthDto) {
    return this.reports.create(user, id, body.month)
  }
  @Get('reports')
  @Header('Cache-Control', 'no-store')
  reportDirectory(@CurrentUser() user: AuthedUser, @Query() query: AdminReportDirectoryQuery) {
    return this.reports.listByMonth(user, query.month, parseFirstOrderListLimit(query.limit))
  }
  @Get('reports/:id')
  @Header('Cache-Control', 'no-store')
  report(@CurrentUser() user: AuthedUser, @Param('id') id: string) { return this.reports.get(user, id) }
  @Get('reports/:id/csv')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="first-order-report.csv"')
  csv(@CurrentUser() user: AuthedUser, @Param('id') id: string) { return this.reports.csv(user, id) }
}

@Controller('partner/first-order')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerFirstOrderController {
  constructor(private readonly projects: FirstOrderProjectsService, private readonly reports: FirstOrderReportsService) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview(@CurrentUser() user: AuthedUser, @Query() _query: FirstOrderEmptyDto) { return this.projects.overview(user) }
  @Get('projects/:id/report-preview')
  @Header('Cache-Control', 'no-store')
  preview(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Query() query: FirstOrderMonthDto) {
    return this.reports.preview(user, id, query.month)
  }
  @Post('projects/:id/reports')
  @Header('Cache-Control', 'no-store')
  createReport(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: FirstOrderMonthDto) {
    return this.reports.create(user, id, body.month)
  }
  @Get('reports/:id')
  @Header('Cache-Control', 'no-store')
  report(@CurrentUser() user: AuthedUser, @Param('id') id: string) { return this.reports.get(user, id) }
  @Get('reports/:id/csv')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="first-order-report.csv"')
  csv(@CurrentUser() user: AuthedUser, @Param('id') id: string) { return this.reports.csv(user, id) }
  @Post('reports/:id/acknowledge')
  @Header('Cache-Control', 'no-store')
  acknowledge(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() _body: FirstOrderEmptyDto) {
    return this.reports.acknowledge(user, id)
  }
}
