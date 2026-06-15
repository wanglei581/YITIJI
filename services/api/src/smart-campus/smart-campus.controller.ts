import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Req, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AuditService } from '../audit/audit.service'
import { SmartCampusService } from './smart-campus.service'
import { SaveSmartCampusConfigDto } from './dto/save-smart-campus-config.dto'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

/**
 * 智慧校园（按终端开关）接口。
 *
 * 路由表（全部含 /api/v1 前缀）：
 *   管理员（Bearer + admin）：
 *     GET  /admin/smart-campus/terminals                       终端 + 智慧校园配置列表
 *     GET  /admin/terminals/:terminalId/smart-campus-config    查询单终端配置
 *     PUT  /admin/terminals/:terminalId/smart-campus-config    保存配置（含审计）
 *   Kiosk（无登录，只读）：
 *     GET  /terminals/:terminalId/smart-campus                 拉取开关 + 子模块开关位
 *   Partner（Bearer + partner）：
 *     GET  /partner/smart-campus/terminals                     本机构终端 + 配置列表
 *     PUT  /partner/smart-campus/terminals/:terminalId/config  保存本机构终端配置
 *
 * 合规（compliance-boundary.md §九）：
 *   - 一期开关由平台运营在 admin 后台代配置（@Roles('admin')）。
 *   - Kiosk 拉取端点免鉴权，返回体白名单：只含 enabled + modules，绝不含任何学生数据。
 */
@Controller()
export class SmartCampusController {
  constructor(
    private readonly smartCampus: SmartCampusService,
    private readonly audit: AuditService,
  ) {}

  // ── 管理员 ────────────────────────────────────────────────────────────────
  @Get('admin/smart-campus/terminals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listTerminals() {
    return this.smartCampus.listSmartCampusTerminals()
  }

  @Get('admin/terminals/:terminalId/smart-campus-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getConfig(@Param('terminalId') terminalId: string) {
    return this.smartCampus.getTerminalConfig(terminalId)
  }

  @Put('admin/terminals/:terminalId/smart-campus-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async saveConfig(
    @Param('terminalId') terminalId: string,
    @Body() dto: SaveSmartCampusConfigDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const config = await this.smartCampus.saveTerminalConfig(
      terminalId,
      { enabled: dto.enabled, modules: dto.modules },
      user.userId,
    )
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'smart_campus_config.update',
      targetType: 'smart_campus_config',
      targetId: terminalId,
      payload: { enabled: config.enabled, modules: config.modules },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return config
  }

  // ── Partner：学校账号只能读写本校终端 ────────────────────────────────────
  @Get('partner/smart-campus/terminals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  listPartnerTerminals(@CurrentUser() user: AuthedUser) {
    return this.smartCampus.listPartnerSmartCampusTerminals(user.orgId)
  }

  @Put('partner/smart-campus/terminals/:terminalId/config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async savePartnerConfig(
    @Param('terminalId') terminalId: string,
    @Body() dto: SaveSmartCampusConfigDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const config = await this.smartCampus.savePartnerTerminalConfig(
      terminalId,
      { enabled: dto.enabled, modules: dto.modules },
      { userId: user.userId, orgId: user.orgId },
    )
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'partner.smart_campus_config.update',
      targetType: 'smart_campus_config',
      targetId: config.terminalId,
      payload: {
        enabled: config.enabled,
        modules: config.modules,
        orgId: user.orgId,
        // 合规：校园大数据本期冻结。bigdataRequested 记录机构端是否尝试开启，
        // bigdataFrozen 标记本次已被强制落 false（即便请求里 bigdata=true）。
        bigdataRequested: Boolean(dto.modules?.bigdata),
        bigdataFrozen: true,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return config
  }

  // ── Kiosk 拉取（无登录，只读）────────────────────────────────────────────
  @Get('terminals/:terminalId/smart-campus')
  @HttpCode(HttpStatus.OK)
  getKioskConfig(@Param('terminalId') terminalId: string) {
    return this.smartCampus.getKioskConfig(terminalId)
  }
}

function extractIp(req: AuditReq): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim()
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}
