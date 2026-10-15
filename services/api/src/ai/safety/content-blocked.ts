import { BadRequestException } from '@nestjs/common'
import { AiContentBlockedError } from '../llm/llm-guard'
import { refusalMessage } from './refusal'

/** 各入口把拦截异常翻成现有的 400。正文用统一拒答语，带上类别追加句。 */
export function contentBlockedException(error: AiContentBlockedError): BadRequestException {
  return new BadRequestException({
    error: { code: 'AI_CONTENT_BLOCKED', message: refusalMessage(error.category) },
  })
}
