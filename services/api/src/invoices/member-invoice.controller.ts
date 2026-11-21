import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { InvoiceRequestsService } from './invoice-requests.service'
import { ListMemberInvoiceOrdersDto, SubmitMemberInvoiceDto } from './member-invoice.dto'

/**
 * 小程序与一体机共用的会员开票接口。会员编号只来自登录态。
 * 列表不返回税号和邮箱；单条查询只返回本人那一份，税号和邮箱只回打码后的 taxIdMasked、emailMasked。
 * 一体机带会员令牌也能调这里，所以这组接口任何响应都不带完整税号和邮箱。
 */
@Controller('me')
@UseGuards(EndUserAuthGuard)
export class MemberInvoiceController {
  constructor(private readonly invoices: InvoiceRequestsService) {}

  @Get('invoice-orders')
  async list(@CurrentEndUser() user: AuthedEndUser, @Query() query: ListMemberInvoiceOrdersDto) {
    return ApiResponse.ok(await this.invoices.listForMember(user.endUserId, { limit: query.limit, cursor: query.cursor }))
  }

  @Post('invoice-requests')
  async create(@CurrentEndUser() user: AuthedEndUser, @Body() body: SubmitMemberInvoiceDto) {
    const stored = await this.invoices.submit(user.endUserId, {
      orderKind: body.orderKind,
      orderId: body.orderId,
      titleType: body.titleType,
      title: body.title,
      taxId: body.taxId,
      email: body.email,
    })
    return ApiResponse.ok({
      id: stored.id,
      orderKind: body.orderKind,
      orderId: body.orderId,
      status: 'submitted' as const,
      amountCents: stored.amountCents,
    })
  }

  @Get('invoice-requests/:id')
  async getOne(@CurrentEndUser() user: AuthedEndUser, @Param('id') id: string) {
    return ApiResponse.ok(await this.invoices.getForMember(user.endUserId, id))
  }
}
