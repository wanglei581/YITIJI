import { BadRequestException, Body, Controller, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { resolveOptionalInternalUser } from '../common/auth/optional-internal-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import type { FileRequester } from '../files/files.service'
import { AuditService } from '../audit/audit.service'
import { ConvertDocumentDto } from './document-conversion.dto'
import { DocumentConversionService } from './document-conversion.service'
import type { DocumentConversionCapabilities, DocumentConversionResponse } from './document-conversion.types'

@Controller()
export class DocumentConversionController {
  constructor(
    private readonly conversion: DocumentConversionService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('document-conversion/capabilities')
  capabilities(): ApiResponse<DocumentConversionCapabilities> {
    return ApiResponse.ok(this.conversion.getCapabilities())
  }

  @Post('files/:id/convert')
  async convert(
    @Param('id') id: string,
    @Body() body: ConvertDocumentDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentConversionResponse>> {
    if (body?.target !== 'pdf') {
      throw new BadRequestException({ error: { code: 'UNSUPPORTED_FILE_TYPE', message: '仅支持转换为 PDF' } })
    }
    const requester = await this.resolveRequester(req)
    if (!requester) {
      throw new UnauthorizedException({ error: { code: 'AUTH_REQUIRED', message: '需登录后转换文件' } })
    }
    const result = await this.conversion.convertOwnedFile(id, requester)
    if (requester.kind === 'user' && requester.role === 'admin') {
      await this.audit.writeRequired(this.prisma, {
        actorId: requester.userId,
        actorRole: 'admin',
        action: 'file.admin_access',
        targetType: 'file',
        targetId: id,
        payload: { purpose: 'document_conversion', disposition: 'inline' },
        ipAddress: req.ip ?? null,
        userAgent: headerOf(req, 'user-agent'),
        requestId: req.requestId ?? null,
      })
    }
    return ApiResponse.ok({
      fileId: result.fileId,
      filename: result.filename,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      pageCount: result.pageCount,
      signedUrl: result.signedUrl,
      expiresAt: result.expiresAt,
      printFileUrl: result.printFileUrl,
      engine: result.engine,
      warnings: result.warnings,
    })
  }

  private async resolveRequester(req: ReqLike): Promise<FileRequester | null> {
    const auth = extractAuth(req)
    const member = await resolveOptionalEndUser(auth, this.jwt, this.redis, this.prisma)
    if (member) return { kind: 'member', endUserId: member.endUserId }
    const internal = await resolveOptionalInternalUser(auth, this.jwt, this.redis, this.prisma)
    if (!internal) return null
    return { kind: 'user', userId: internal.userId, role: internal.role, orgId: internal.orgId }
  }
}

type ReqLike = Express.Request & {
  requestId?: string
  ip?: string
  headers: Record<string, string | string[] | undefined>
}

function extractAuth(req: ReqLike): string | undefined {
  return headerOf(req, 'authorization')
}

function headerOf(req: ReqLike, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}
