import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common'
import { AiUse, AiUseExempt, MaintenanceBlocked } from '../ai-access/ai-access.decorator'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { TerminalScopedThrottle, PaidAiThrottle } from '../common/throttler/terminal-throttle'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { CreateMaterialTaskDto } from './dto/create-material-task.dto'
import { DecidePiiFindingsDto } from './dto/decide-pii-findings.dto'
import { ConfirmManualCheckDto } from './dto/confirm-manual-check.dto'
import { MaterialsManualConfirmationService } from './materials-manual-confirmation.service'
import { MaterialsService } from './materials.service'
import type { DocumentProcessTaskView, MaterialsRequester } from './materials.types'
import { PrintParamSuggestionService } from './print-param-suggestion.service'
import type { PrintParamSuggestionView } from './print-param-suggestion.types'

const MATERIAL_CHECK_EXEMPT_REASON = '打印前材料检查不调生成式模型，是原件打印必经；AI 暂停、登录档位与声明都不能挡打印'

@Controller('materials')
export class MaterialsController {
  constructor(
    private readonly materials: MaterialsService,
    private readonly printParamSuggestions: PrintParamSuggestionService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly manualConfirmation: MaterialsManualConfirmationService,
  ) {}

  /**
   * 打印前材料检查（体检 / 规整 / 隐私扫描 / 遮挡 / 合订），五种都不调生成式模型，是原件打印的必经一步。
   * 此前标成 @AiUse('generate')，于是后台「AI 暂停」、登录档位（开始 AI 前登录）、14 周岁声明
   * 任何一个打开，匿名用户的原件打印就一起停——违背「AI 挂了功能退化为手动」。现在显式豁免这三道闸，
   * 只保留全机维护的拦截（与打印下单一致）。
   */
  @Post('tasks')
  @PaidAiThrottle(30)
  @AiUseExempt(MATERIAL_CHECK_EXEMPT_REASON)
  @MaintenanceBlocked()

  async createTask(
    @Body() dto: CreateMaterialTaskDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.materials.createTask(dto, requester))
  }

  // PrintMaterialCheckPage 每 1 秒轮询、最多 30 次 = 单台机器 30 秒吃掉半个默认桶。
  // 按 IP 计数时同一大厅两台机器同时做材料检查就会撞线，故按台计数。
  @Get('tasks/:id')
  @TerminalScopedThrottle(90)
  @AiUse('read')

  async getTask(
    @Param('id') id: string,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.materials.getTask(id, requester))
  }

  /**
   * S3-1：按文件体检结果给出打印参数预填建议（份数 / 黑白彩色 / 单双面 / 每页张数）。
   *
   * 只读、只建议。服务端不会用返回值建单或报价，用户不确认就没有任何参数生效。
   * 预填不可用时返回 200 + available:false + 明确原因，**不阻断打印流程**。
   */
  @Get('tasks/:id/print-param-suggestions')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @AiUse('read')

  async getPrintParamSuggestions(
    @Param('id') id: string,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<PrintParamSuggestionView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.printParamSuggestions.suggestForInspectionTask(id, requester))
  }

  /** 逐项保留 / 遮挡的本人裁决：同上，不调模型，打印必经；中途不受维护拦截（已开始的检查允许做完）。 */
  @Post('tasks/:id/pii-findings/decisions')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @AiUseExempt(MATERIAL_CHECK_EXEMPT_REASON)

  async decidePiiFindings(
    @Param('id') id: string,
    @Body() dto: DecidePiiFindingsDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.materials.decidePiiFindings(id, dto, requester))
  }

  /**
   * 隐私检查没有完整覆盖（partial / degraded / unsupported_format）时的本人确认（A-04）。
   * 与逐项裁决同鉴权；重复确认幂等。建单是否要求这一步由 PRINT_PII_MANUAL_CONFIRM_ENFORCED 决定。
   */
  @Post('tasks/:id/manual-confirmation')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @AiUseExempt(MATERIAL_CHECK_EXEMPT_REASON)
  async confirmManualCheck(
    @Param('id') id: string,
    @Body() _dto: ConfirmManualCheckDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<DocumentProcessTaskView>> {
    const requester = await this.resolveRequester(req)
    return ApiResponse.ok(await this.manualConfirmation.confirm(id, requester))
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
