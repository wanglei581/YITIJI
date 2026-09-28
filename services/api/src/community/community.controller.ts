import { Controller, Get, Headers, Query } from '@nestjs/common'
import { CommunityService } from './community.service'
import { ListCommunityFeedsDto } from './dto/list-community-feeds.dto'
import type { CommunityFeedPage } from './community.types'
import { PolicyScopeService } from '../policies/policy-scope.service'

@Controller('community')
export class CommunityController {
  constructor(
    private readonly community: CommunityService,
    private readonly policyScope: PolicyScopeService,
  ) {}


  @Get('feeds')
  async listFeeds(
    @Query() query: ListCommunityFeedsDto,
    @Headers('x-terminal-id') terminalId?: string,
    @Headers('x-terminal-session-token') sessionToken?: string,
  ): Promise<CommunityFeedPage> {
    return this.community.list(query.cursor, query.limit, await this.policyScope.resolve({ headers: { 'x-terminal-id': terminalId, 'x-terminal-session-token': sessionToken } }))
  }
}
