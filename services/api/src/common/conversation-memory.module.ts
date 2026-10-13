import { Module } from '@nestjs/common'
import { AdvisorQaMemory } from '../advisor/advisor-qa-memory'
import { ConversationMemoryBridge } from './conversation-memory-bridge'

/** 作业问答内存和对话清理桥。两边都能引这一小块，不经过 AdvisorModule / AiModule。 */
@Module({
  providers: [AdvisorQaMemory, ConversationMemoryBridge],
  exports: [AdvisorQaMemory, ConversationMemoryBridge],
})
export class ConversationMemoryModule {}
