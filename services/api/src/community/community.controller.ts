import { Controller, Get, Headers, Optional, Query } from '@nestjs/common'
import { CommunityService } from './community.service'
import { ListCommunityFeedsDto } from './dto/list-community-feeds.dto'
import type { CommunityFeedPage } from './community.types'
import { PolicyScopeService, resolvePolicyScope } from '../policies/policy-scope.service'

@Controller('community')
export class CommunityController {
  constructor(
    private readonly community: CommunityService,
    @Optional() private readonly policyScope?: PolicyScopeService,
  ) {}


  @Get('feeds')
  async listFeeds(
    @Query() query: ListCommunityFeedsDto,
    @Headers('x-terminal-id') terminalId?: string,
    @Headers('x-terminal-session-token') sessionToken?: string,
  ): Promise<CommunityFeedPage> {
    return this.community.list(query.cursor, query.limit, await resolvePolicyScope(this.policyScope, { headers: { 'x-terminal-id': terminalId, 'x-terminal-session-token': sessionToken } }))
  }
}
