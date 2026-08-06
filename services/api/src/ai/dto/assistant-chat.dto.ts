import { IsIn, IsString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator'
import type { ChatOutput } from '../interfaces/ai-provider.interface'

const ASSISTANT_SKILLS = [
  'offer_compare',
  'salary_negotiation',
  'hr_qa',
  'self_intro_gen',
  'material_checklist',
  'jd_analysis',
  'interview_questions',
  'career_explore',
  'cover_letter_gen',
  'resume_jd_match',
  'company_research',
] as const

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
  @IsString()
  @IsIn(ASSISTANT_SKILLS)
  skill?: (typeof ASSISTANT_SKILLS)[number]

  @IsOptional()
  context?: Record<string, unknown>
}

/** Response aligns with shared AssistantChatResponse */
export type AssistantChatResponseDto = ChatOutput
