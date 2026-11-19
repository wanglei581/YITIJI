import { Module } from '@nestjs/common'
import { MiniappAccessTokenModule } from '../miniapp-access-token/miniapp-access-token.module'
import { MiniappCodeController } from './miniapp-code.controller'
import { MiniappCodeService } from './miniapp-code.service'

@Module({
  imports: [MiniappAccessTokenModule],
  controllers: [MiniappCodeController],
  providers: [MiniappCodeService],
  exports: [MiniappCodeService],
})
export class MiniappCodeModule {}
