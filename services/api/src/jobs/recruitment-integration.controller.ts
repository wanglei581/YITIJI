import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JobsService } from './jobs.service'
import { ImportFairsDto } from './dto/import-fairs.dto'
import { ImportJobsDto } from './dto/import-jobs.dto'
import { assertPartnerDataTypeCapability } from './partner-capabilities'
import {
  buildRecruitmentIntegrationContract,
  summarizeFairPreflight,
  summarizeJobPreflight,
} from './recruitment-integration.contract'

@Controller('partner/data-sources')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class RecruitmentIntegrationController {
  constructor(private readonly jobs: JobsService) {}

  @Get('integration-contract')
  async getContract(@CurrentUser() user: AuthedUser) {
    const capabilities = await this.jobs.getPartnerDataSourceCapabilities(user)
    return buildRecruitmentIntegrationContract(capabilities)
  }

  @Post('preflight/jobs')
  async preflightJobs(@Body() dto: ImportJobsDto, @CurrentUser() user: AuthedUser) {
    const capabilities = await this.jobs.getPartnerDataSourceCapabilities(user)
    assertPartnerDataTypeCapability(capabilities.orgType, 'job')
    return summarizeJobPreflight(dto.items)
  }

  @Post('preflight/fairs')
  async preflightFairs(@Body() dto: ImportFairsDto, @CurrentUser() user: AuthedUser) {
    const capabilities = await this.jobs.getPartnerDataSourceCapabilities(user)
    assertPartnerDataTypeCapability(capabilities.orgType, 'fair')
    return summarizeFairPreflight(dto.items)
  }
}
