import { Controller, Get, Query } from '@nestjs/common'
import { CommunityService } from './community.service'
import { ListCommunityFeedsDto } from './dto/list-community-feeds.dto'
import type { CommunityFeedPage } from './community.types'

@Controller('community')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('feeds')
  async listFeeds(@Query() query: ListCommunityFeedsDto): Promise<CommunityFeedPage> {
    return this.community.list(query.cursor, query.limit)
  }
}
