import { Module } from '@nestjs/common'
import { ScreensaverController } from './screensaver.controller'
import { ScreensaverService } from './screensaver.service'

@Module({
  controllers: [ScreensaverController],
  providers: [ScreensaverService],
})
export class ScreensaverModule {}
