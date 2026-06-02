import { Module } from '@nestjs/common'
import { TrtcController } from './trtc.controller'
import { TrtcService } from './trtc.service'

@Module({
  controllers: [TrtcController],
  providers:   [TrtcService],
})
export class TrtcModule {}
