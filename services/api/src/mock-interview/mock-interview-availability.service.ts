import { Injectable } from '@nestjs/common'
import { AiAccessService } from '../ai-access/ai-access.service'
import type { AiRefusal } from '../ai/assistant-chat-availability'
import { LlmConfigService } from '../ai/llm/llm-config.service'
import { mockInterviewStartRefusal } from './mock-interview-availability'

/** 开场接口与只读探针共用的那一个判断。 */
@Injectable()
export class MockInterviewAvailability {
  constructor(
    private readonly access: AiAccessService,
    private readonly llm: LlmConfigService,
  ) {}

  refusal(): Promise<AiRefusal | null> {
    return mockInterviewStartRefusal(this.access, this.llm)
  }
}
