import { IsNumber, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class ClaimTasksDto {
  /** Max tasks to claim in one cycle. Phase 8.1B MVP: server returns at most 1. */
  @IsNumber()
  @Min(1)
  @Max(3)
  @Type(() => Number)
  maxTasks!: number
}
