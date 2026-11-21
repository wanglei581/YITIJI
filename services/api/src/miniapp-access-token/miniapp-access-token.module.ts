import { Module } from '@nestjs/common'
import { MiniappAccessTokenService } from './miniapp-access-token.service'

@Module({
  providers: [MiniappAccessTokenService],
  exports: [MiniappAccessTokenService],
})
export class MiniappAccessTokenModule {}
