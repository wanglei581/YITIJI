import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { DeviceFleetController } from './device-fleet.controller'
import { DeviceFleetService } from './device-fleet.service'

@Module({
  imports: [AuthModule],
  controllers: [DeviceFleetController],
  providers: [DeviceFleetService],
  exports: [DeviceFleetService],
})
export class DeviceFleetModule {}
