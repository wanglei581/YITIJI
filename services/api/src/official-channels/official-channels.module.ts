import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { OfficialChannelsController } from './official-channels.controller'
import { OfficialChannelsService } from './official-channels.service'

@Module({
  imports: [PrismaModule, AuthModule, TerminalsModule],
  controllers: [OfficialChannelsController],
  providers: [OfficialChannelsService],
  exports: [OfficialChannelsService],
})
export class OfficialChannelsModule {}
