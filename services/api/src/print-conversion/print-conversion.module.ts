import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { PrintConversionController } from './print-conversion.controller'
import { PrintConversionService } from './print-conversion.service'

@Module({
  imports: [FilesModule, JwtVerifierModule],
  controllers: [PrintConversionController],
  providers: [PrintConversionService],
})
export class PrintConversionModule {}
