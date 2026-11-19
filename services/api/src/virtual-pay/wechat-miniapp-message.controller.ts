import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { RawBodyRequest } from '../config/body-parsers'
import { WechatMiniappMessageService } from './wechat-miniapp-message.service'

/** 推送地址同时接 GET 验证和 POST 安全模式。路径不含价格。 */
@Controller('wechat/miniapp')
export class WechatMiniappMessageController {
  constructor(private readonly messages: WechatMiniappMessageService) {}

  @Get('message')
  verify(@Query() query: Record<string, unknown>, @Res() res: Response): void {
    this.send(res, this.messages.verifyUrl(query))
  }

  @Post('message')
  async receive(
    @Query() query: Record<string, unknown>,
    @Req() req: RawBodyRequest,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.messages.receive(req.rawBody, req.header('content-type') ?? '', query)
    this.send(res, result)
  }

  /** 成功应答是 text/plain，不能让 Nest 把字符串再 JSON 编码。 */
  private send(res: Response, result: { status: 200; text: string } | { status: number; code: string; message: string }): void {
    if (result.status === 200 && 'text' in result) {
      res.status(200).type('text/plain; charset=utf-8').send(result.text)
      return
    }
    const failed = result as { status: number; code: string; message: string }
    res.status(failed.status).type('application/json; charset=utf-8').send(JSON.stringify({
      error: { code: failed.code, message: failed.message },
    }))
  }
}
