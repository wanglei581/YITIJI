import { Global, Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { PrismaModule } from '../prisma/prisma.module'
import { DocumentConversionController } from './document-conversion.controller'
import { DocumentConversionService, probeCjkFonts } from './document-conversion.service'
import { GotenbergConversionAdapter } from './gotenberg.adapter'
import { SofficeConversionAdapter } from './soffice.adapter'
import { DOCUMENT_CONVERSION_ADAPTER, DOCUMENT_CONVERSION_FONT_PROBE } from './document-conversion.types'

@Global()
@Module({
  imports: [FilesModule, PrismaModule, JwtVerifierModule],
  controllers: [DocumentConversionController],
  providers: [
    {
      provide: DOCUMENT_CONVERSION_ADAPTER,
      useFactory: () => {
        const engine = process.env['CONVERSION_ENGINE']?.trim().toLowerCase() || 'disabled'
        if (engine === 'soffice') return new SofficeConversionAdapter(process.env['SOFFICE_PATH']?.trim() || '')
        if (engine === 'gotenberg') return new GotenbergConversionAdapter(process.env['GOTENBERG_URL']?.trim() || '')
        return null
      },
    },
    { provide: DOCUMENT_CONVERSION_FONT_PROBE, useValue: probeCjkFonts },
    DocumentConversionService,
  ],
  exports: [DocumentConversionService],
})
export class DocumentConversionModule {}

