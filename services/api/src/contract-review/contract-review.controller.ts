import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { ContractReviewConsentService } from './contract-review-consent.service'
import { ContractReviewLifecycleService } from './contract-review-lifecycle.service'
import type { ContractReviewRequester } from './contract-review.types'
import { ConfirmContractReviewDto, CreateContractReviewDto } from './dto/contract-review.dto'

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>
}

function headerOf(req: RequestLike, name: string): string | null {
  const value = req.headers?.[name.toLowerCase()]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && value[0]?.trim()) return value[0].trim()
  return null
}

@Controller('contract-reviews')
export class ContractReviewController {
  constructor(
    private readonly lifecycle: ContractReviewLifecycleService,
    private readonly consent: ContractReviewConsentService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async requesterOf(req: RequestLike): Promise<ContractReviewRequester> {
    const authorization = headerOf(req, 'authorization') ?? undefined
    const member = await resolveOptionalEndUser(authorization, this.jwt, this.redis, this.prisma)
    if (member) {
      return { endUserId: member.endUserId, accessToken: null, sourceFileProof: null }
    }
    return {
      endUserId: null,
      accessToken: headerOf(req, 'x-contract-review-access-token'),
      // Preserve a proof header on every anonymous request so the shared access
      // gate can reject proof replay outside create with the same 404 envelope.
      sourceFileProof: headerOf(req, 'x-contract-review-source-file-proof'),
    }
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async create(@Body() dto: CreateContractReviewDto, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.createAndEnqueue(
      dto,
      await this.requesterOf(req),
    ))
  }

  @Get('consent-scope')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async consentScope() {
    return ApiResponse.ok(await this.consent.getConsentScope())
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.get(id, await this.requesterOf(req)))
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmContractReviewDto,
    @Req() req: RequestLike,
  ) {
    return ApiResponse.ok(await this.lifecycle.confirmAndEnqueue(
      id,
      dto,
      await this.requesterOf(req),
    ))
  }

  @Post(':id/report')
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  async report(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.createReport(id, await this.requesterOf(req)))
  }

  @Delete('reports/:fileId')
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  async abandonReport(@Param('fileId') fileId: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.abandonReport(
      fileId,
      headerOf(req, 'x-contract-review-report-abandon-token'),
    ))
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.remove(id, await this.requesterOf(req)))
  }
}
