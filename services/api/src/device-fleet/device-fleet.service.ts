import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { buildDeviceFleetOverview } from './device-fleet.projection'
import type { DeviceFleetOverview } from './device-fleet.types'

@Injectable()
export class DeviceFleetService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<DeviceFleetOverview> {
    const [terminals, screensaverConfigs, smartCampusConfigs, toolboxConfigs] = await Promise.all([
      this.prisma.terminal.findMany({
        orderBy: { terminalCode: 'asc' },
        select: {
          id: true,
          terminalCode: true,
          displayName: true,
          locationLabel: true,
          enabled: true,
          org: { select: { name: true } },
          heartbeats: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, agentVersion: true, createdAt: true },
          },
        },
      }),
      this.prisma.terminalScreensaverConfig.findMany({
        select: { terminalId: true, enabled: true, playlistId: true, updatedAt: true },
      }),
      this.prisma.terminalSmartCampusConfig.findMany({
        select: { terminalId: true, enabled: true, modulesJson: true, updatedAt: true },
      }),
      this.prisma.terminalToolboxConfig.findMany({
        select: { terminalId: true, enabled: true, itemsJson: true, updatedAt: true },
      }),
    ])

    return buildDeviceFleetOverview(
      { terminals, screensaverConfigs, smartCampusConfigs, toolboxConfigs },
      new Date(),
    )
  }
}
