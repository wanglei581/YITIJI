import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
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
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.materials.getTask(id, requester))
  }

  @Post('tasks/:id/pii-findings/decisions')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async decidePiiFindings(
    @Param('id') id: string,
    @Body() dto: DecidePiiFindingsDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.materials.decidePiiFindings(id, dto, requester))
  }

  private async resolveRequester(req: ReqLike): Promise<MaterialsRequester> {
    assertMaterialTaskTokenNotInQuery(req.query)
    const member = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
    if (member) return { kind: 'member', endUserId: member.endUserId }
    return { kind: 'anonymous', accessToken: extractMaterialTaskToken(req) }
  }
}

type ReqLike = Express.Request & {
  requestId?: string
  headers: Record<string, string | string[] | undefined>
  query?: unknown
}

function extractAuth(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}

export function assertMaterialTaskTokenNotInQuery(query: unknown): void {
  if (!query || typeof query !== 'object') return
  if (!Object.prototype.hasOwnProperty.call(query, 'accessToken')) return
  throw new BadRequestException({
    error: {
      code: 'MATERIAL_TOKEN_QUERY_FORBIDDEN',
      message: '匿名材料任务凭证不得放入 URL query，请使用 x-material-task-token 请求头',
    },
  })
}

export function extractMaterialTaskToken(
  req: { headers: Record<string, string | string[] | undefined> },
): string | undefined {
  const header = req.headers['x-material-task-token']
  if (typeof header === 'string' && header.trim()) return header.trim()
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim()
  return undefined
}
