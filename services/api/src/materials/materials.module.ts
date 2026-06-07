import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../prisma/prisma.module'
import { StorageModule } from '../storage/storage.module'
import { MaterialsController } from './materials.controller'
import { MaterialsCleanupTask } from './materials.cleanup.task'
import { MaterialsService } from './materials.service'

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    JwtModule.register({ secret: process.env['JWT_SECRET'] ?? 'dev-only-secret' }),
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialsCleanupTask],
  exports: [MaterialsService],
})
export class MaterialsModule {}
