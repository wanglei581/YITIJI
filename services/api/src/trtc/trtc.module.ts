import { Module } from '@nestjs/common'
import { TerminalsModule } from '../terminals/terminals.module'
import { TrtcController } from './trtc.controller'
import { TrtcService } from './trtc.service'

@Module({
  imports:     [TerminalsModule],
  controllers: [TrtcController],
  providers:   [TrtcService],
})
export class TrtcModule {}
