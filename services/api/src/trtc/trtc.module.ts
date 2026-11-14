import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { TrtcController } from './trtc.controller'
import { TrtcSessionRegistry } from './trtc-session-registry.service'
import { TrtcService } from './trtc.service'

@Module({
  imports:     [TerminalsModule, AiModule],
  controllers: [TrtcController],
  providers:   [TrtcService, TrtcSessionRegistry],
})
export class TrtcModule {}
