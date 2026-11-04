import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AiSafetyLexiconService } from './ai-safety-lexicon.service'

@Controller('admin/ai-safety/lexicon')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AiSafetyLexiconController {
  constructor(private readonly lexicon: AiSafetyLexiconService) {}

  @Get()
  get() {
    return this.lexicon.view()
  }

  @Put()
  put(@Body() body: unknown, @CurrentUser() user: AuthedUser) {
    return this.lexicon.update(body as never, user)
  }
}
