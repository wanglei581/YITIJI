import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberDataExportDownloadService } from './member-data-export-download.service'
import { MemberDataRequestService } from './member-data-request.service'
import { MemberPrivacyService } from './member-privacy.service'
import type { MemberAiConsentScope, MemberDataRequestType } from './member-privacy.types'

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
}

function headerOf(req: ReqLike, name: string): string | null {
  const value = req.headers?.[name]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && value[0]?.trim()) return value[0].trim()
  return null
}

function terminalIdOf(req: ReqLike): string | null {
  return headerOf(req, 'x-terminal-id')?.slice(0, 64) ?? null
}

class GrantAiConsentDto {
  @IsIn(['job_ai'])
  scope!: MemberAiConsentScope
}

interface CreateDataRequestShape {
  requestType: 'export' | 'delete' | 'revoke_consent'
}

class CreateDataRequestDto implements CreateDataRequestShape {
  @IsIn(['export', 'delete', 'revoke_consent'])
  requestType!: 'export' | 'delete' | 'revoke_consent'
}

class ListDataRequestsQueryDto {
  @IsOptional() @IsString() @MaxLength(512)
  cursor?: string

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number
}

class EmptyDto {}

@Controller('me/ai-consents')
@UseGuards(EndUserAuthGuard)
export class MemberPrivacyController {
  constructor(private readonly privacy: MemberPrivacyService) {}

  @Get('status')
  async getConsentStatus(@CurrentEndUser() user: AuthedEndUser) {
    return ApiResponse.ok(await this.privacy.getConsentStatus(user.endUserId))
  }

  @Post()
  async grantConsent(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: GrantAiConsentDto,
    @Req() req: ReqLike,
  ) {
    return ApiResponse.ok(await this.privacy.grantConsent(user.endUserId, dto.scope, terminalIdOf(req)))
  }

  @Post(':scope/revoke')
  async revokeConsent(@CurrentEndUser() user: AuthedEndUser, @Param('scope') scope: MemberAiConsentScope) {
    return ApiResponse.ok(await this.privacy.revokeConsent(user.endUserId, scope))
  }
}

@Controller('me/data-requests')
@UseGuards(EndUserAuthGuard)
export class MemberDataRequestController {
  constructor(
    private readonly requests: MemberDataRequestService,
    private readonly downloads: MemberDataExportDownloadService,
  ) {}

  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query() query: ListDataRequestsQueryDto,
  ) {
    return ApiResponse.ok(await this.requests.list(user.endUserId, query.cursor, query.limit))
  }

  @Post()
  async create(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: CreateDataRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-member-step-up-token') stepUpToken: string | undefined,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ) {
    const requestType: MemberDataRequestType = dto.requestType
    return ApiResponse.ok(await this.requests.create(
      user.endUserId,
      requestType,
      idempotencyKey ?? '',
      stepUpToken ?? null,
      terminalId?.slice(0, 128) ?? null,
    ))
  }

  @Post(':id/download-authorizations')
  async authorizeDownload(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
    @Body() _dto: EmptyDto,
    @Headers('x-member-step-up-token') stepUpToken: string | undefined,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ) {
    return ApiResponse.ok(await this.downloads.authorizeDownload(
      user.endUserId,
      id,
      stepUpToken ?? null,
      terminalId?.slice(0, 128) ?? null,
    ))
  }
}
