import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminInvoiceService } from './admin-invoice.service'
import { IssueInvoiceDto, ReturnInvoiceDto } from './admin-invoice.dto'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminInvoiceController {
  constructor(private readonly invoices: AdminInvoiceService) {}

  @Get('admin/orders/:id/invoice')
  async getByOrder(@Param('id') id: string, @Query('orderKind') orderKind?: string) {
    if (orderKind !== 'print' && orderKind !== 'service') {
      throw new BadRequestException({
        error: { code: 'INVOICE_ORDER_KIND_INVALID', message: '订单种类只能是打印订单或服务单。' },
      })
    }
    return this.invoices.getByOrder(orderKind, id)
  }

  @Post('admin/invoice-requests/:id/issue')
  async issue(@Param('id') id: string, @Body() body: IssueInvoiceDto, @CurrentUser() user: AuthedUser) {
    return this.invoices.markIssued(id, { invoiceNo: body.invoiceNo, operatorId: user.userId })
  }

  @Post('admin/invoice-requests/:id/return')
  returnRequest(@Param('id') id: string, @Body() body: ReturnInvoiceDto, @CurrentUser() user: AuthedUser) {
    return this.invoices.returnRequest(id, { reason: body.reason, operatorId: user.userId })
  }
}
