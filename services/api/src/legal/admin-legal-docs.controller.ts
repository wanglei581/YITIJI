import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common'
import { LegalService } from './legal.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { CreateLegalDocDto } from './dto/admin-legal-doc.dto'

@Controller('admin/legal-doc-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminLegalDocsController {
  constructor(private readonly service: LegalService) {}

  /** GET /api/v1/admin/legal-doc-versions?docType=xxx — 列出全部版本 */
  @Get()
  async list(@Query('docType') docType?: string) {
    return { success: true, data: await this.service.list(docType) }
  }

  /**
   * GET /api/v1/admin/legal-doc-versions/:id — 读取单个版本（含正文）。
   * 只给管理员（方法上再声明一次，不只靠类级装饰器）；每次读取写 legal_doc.view 访问审计。
   */
  @Get(':id')
  @Roles('admin')
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return { success: true, data: await this.service.getById(id, { userId: user.userId, role: user.role }) }
  }

  /** POST /api/v1/admin/legal-doc-versions — 新建草稿 */
  @Post()
  async create(
    @Body() body: CreateLegalDocDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return {
      success: true,
      data: await this.service.create({ ...body, adminId: user.userId }),
    }
  }

  /** PATCH /api/v1/admin/legal-doc-versions/:id/activate — 激活版本 */
  @Patch(':id/activate')
  async activate(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return { success: true, data: await this.service.activate(id, user.userId) }
  }
}
