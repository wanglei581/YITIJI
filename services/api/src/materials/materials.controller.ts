import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { CreateMaterialTaskDto } from './dto/create-material-task.dto'
import { DecidePiiFindingsDto } from './dto/decide-pii-findings.dto'
import { MaterialsService } from './materials.service'
import type { DocumentProcessTaskView, MaterialsRequester } from './materials.types'

@Controller('materials')
export class MaterialsController {
  constructor(
    private readonly materials: MaterialsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('tasks')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async createTask(
    @Body() dto: CreateMaterialTaskDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.materials.createTask(dto, requester))
  }

  @Get('tasks/:id')
  async getTask(
    @Param('id') id: string,
    @Query('accessToken') accessToken: string | undefined,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req, accessToken)
    return ApiResponse.ok(await this.materials.getTask(id, requester))
  }

  @Post('tasks/:id/pii-findings/decisions')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async decidePiiFindings(
    @Param('id') id: string,
    @Query('accessToken') accessToken: string | undefined,
    @Body() dto: DecidePiiFindingsDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req, accessToken)
    return ApiResponse.ok(await this.materials.decidePiiFindings(id, dto, requester))
  }

  private async resolveRequester(req: ReqLike, queryToken?: string): Promise<MaterialsRequester> {
    const member = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
    if (member) return { kind: 'member', endUserId: member.endUserId }
    return { kind: 'anonymous', accessToken: extractAccessToken(req, queryToken) }
  }
}

type ReqLike = Express.Request & {
  requestId?: string
  headers: Record<string, string | string[] | undefined>
}

function extractAuth(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}

function extractAccessToken(
  req: { headers: Record<string, string | string[] | undefined> },
  queryToken?: string,
): string | undefined {
  const header = req.headers['x-material-task-token']
  if (typeof header === 'string' && header.trim()) return header.trim()
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim()
  return queryToken?.trim() || undefined
}
