import { Injectable } from '@nestjs/common'
import { AiAccessService } from '../ai-access/ai-access.service'
import { LlmConfigService } from './llm/llm-config.service'
import { assistantChatRefusal, type AiRefusal } from './assistant-chat-availability'

/** 对话入口与只读探针共用的那一个判断。生产模块会注入；旧门禁用空对象构造控制器时拿不到。 */
@Injectable()
export class AssistantChatAvailability {
  constructor(
    private readonly access: AiAccessService,
    private readonly llm: LlmConfigService,
  ) {}

  refusal(): Promise<AiRefusal | null> {
    return assistantChatRefusal(this.access, this.llm)
  }
}
