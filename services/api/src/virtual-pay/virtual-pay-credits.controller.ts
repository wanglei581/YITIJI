import { Controller, Get, UseGuards } from '@nestjs/common'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { VirtualPayCreditsService } from './virtual-pay-credits.service'

@Controller('member')
@UseGuards(EndUserAuthGuard)
export class VirtualPayCreditsController {
  constructor(private readonly credits: VirtualPayCreditsService) {}

  @Get('service-credits')
  list(@CurrentEndUser() user: AuthedEndUser) {
    return this.credits.listAvailable(user.endUserId)
  }
}
