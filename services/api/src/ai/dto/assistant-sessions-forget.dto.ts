import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength } from 'class-validator'

/** 小青会话号是 randomBytes(16) 的小写十六进制，共 32 位。 */
export class AssistantSessionsForgetDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  @Matches(/^[0-9a-f]{32}$/, { each: true })
  sessionIds!: string[]
}
