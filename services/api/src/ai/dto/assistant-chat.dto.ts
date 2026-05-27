import { IsString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator'
import type { ChatOutput } from '../interfaces/ai-provider.interface'

export class AssistantChatRequestDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  message!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string

  @IsOptional()
  context?: Record<string, unknown>
}

/** Response aligns with shared AssistantChatResponse */
export type AssistantChatResponseDto = ChatOutput
