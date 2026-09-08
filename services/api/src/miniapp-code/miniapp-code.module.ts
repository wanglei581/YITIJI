import { Module } from '@nestjs/common'
import { MiniappCodeController } from './miniapp-code.controller'
import { MiniappCodeService } from './miniapp-code.service'

@Module({
  controllers: [MiniappCodeController],
  providers: [MiniappCodeService],
  exports: [MiniappCodeService],
})
export class MiniappCodeModule {}
