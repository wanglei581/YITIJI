import { Module } from '@nestjs/common'
import { AdminOpsModule } from '../admin-ops/admin-ops.module'
import { AuthModule } from '../auth/auth.module'
import { DeviceFleetModule } from '../device-fleet/device-fleet.module'
import { AdminScreenController, PartnerScreenController } from './console-screen.controller'
import { ScreenSnapshotCache } from './console-screen.cache'
import { ConsoleScreenService } from './console-screen.service'

@Module({
  imports: [AuthModule, DeviceFleetModule, AdminOpsModule],
  controllers: [AdminScreenController, PartnerScreenController],
  providers: [ConsoleScreenService, ScreenSnapshotCache],
})
export class ConsoleScreenModule {}
