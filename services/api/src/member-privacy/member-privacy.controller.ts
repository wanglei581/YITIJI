import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
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

class ListDataRequestDto {
  @IsOptional() @IsString() @MaxLength(64)
  cursor?: string
}

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
  constructor(private readonly requests: MemberDataRequestService) {}

  @Get()
  async list(@CurrentEndUser() user: AuthedEndUser, @Query() query: ListDataRequestDto) {
    return ApiResponse.ok(await this.requests.listMyDataRequests(user.endUserId, query.cursor))
  }

  @Post()
  async create(@CurrentEndUser() user: AuthedEndUser, @Body() dto: CreateDataRequestDto, @Req() req: ReqLike) {
    const requestType: MemberDataRequestType = dto.requestType
    return ApiResponse.ok(await this.requests.create(user.endUserId, {
      requestType,
      idempotencyKey: headerOf(req, 'idempotency-key'),
      stepUpToken: headerOf(req, 'x-member-step-up-token'),
      terminalId: terminalIdOf(req),
    }))
  }
}
