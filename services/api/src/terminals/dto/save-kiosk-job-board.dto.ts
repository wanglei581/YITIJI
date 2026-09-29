import { IsBoolean } from 'class-validator'

export class SaveKioskJobBoardDto {
  @IsBoolean()
  enabled!: boolean
}
