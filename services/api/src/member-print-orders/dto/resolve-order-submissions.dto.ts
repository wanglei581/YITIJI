import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator'

/** Owner-scoped batch resolve for print and package Idempotency-Key values. */
export class ResolveOrderSubmissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  keys!: string[]
}
